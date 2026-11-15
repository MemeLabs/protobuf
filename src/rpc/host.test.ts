import assert from "assert";
import { spawn } from "child_process";
import { PassThrough } from "stream";

import { Call, Call_Kind, Cancel, ICall, Error as RPCError } from "../apis/strims/rpc/rpc";
import { TestMessage } from "../apis/strims/test/message";
import {
  RPCCallStreamRequest,
  RPCCallStreamResponse,
  RPCCallUnaryRequest,
  RPCCallUnaryResponse,
} from "../apis/strims/test/rpc";
import { Message } from "../pb/message";
import Reader from "../pb/reader";
import Writer from "../pb/writer";
import Host from "./host";
import ServiceRegistry from "./service";

const {
  CALL_KIND_DEFAULT: DEFAULT,
  CALL_KIND_ERROR: ERROR,
  CALL_KIND_CANCEL: CANCEL,
  CALL_KIND_CLOSE: CLOSE,
  CALL_KIND_UNDEFINED: UNDEFINED,
} = Call_Kind;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// what p has come to after ms
const state = (p: Promise<unknown>, ms = 20) =>
  Promise.race([
    p.then(
      () => "resolved",
      () => "rejected"
    ),
    sleep(ms).then(() => "pending"),
  ]);

const encodeArg = (m: unknown): Uint8Array =>
  (m as Message<unknown>).constructor.encode(m, new Writer()).finish().slice();

// a Call as the peer writes it: length-delimited
const frame = (c: ICall): Uint8Array =>
  Call.encode(new Call(c), new Writer().fork()).ldelim().finish().slice();

const request = (id: number, method: string, arg: unknown): ICall => ({
  id: BigInt(id),
  method,
  argument: encodeArg(arg),
});

const callback = (parentId: bigint, kind: Call_Kind, arg?: unknown): ICall => ({
  id: BigInt(1000),
  parentId,
  method: "CALLBACK",
  kind,
  argument: arg === undefined ? new Uint8Array() : encodeArg(arg),
});

const cancel = (parentId: number, kind: Call_Kind): ICall => ({
  id: BigInt(2000),
  parentId: BigInt(parentId),
  method: "CANCEL",
  kind,
  argument: encodeArg(new Cancel()),
});

// A host, and the peer's side of its connection: the calls the host wrote,
// decoded, and send, which writes it frames.
const connect = (service?: ServiceRegistry) => {
  const w = new PassThrough();
  const r = new PassThrough();
  const out: Call[] = [];
  w.on("data", (b: Uint8Array) => {
    const reader = new Reader(b);
    while (reader.pos < reader.len) {
      out.push(Call.decode(reader, reader.uint32()));
    }
  });
  const host = new Host(w, r, service);
  const send = (...calls: ICall[]) => {
    for (const c of calls) {
      r.write(frame(c));
    }
  };
  // the calls a test's handlers and streams hold on to, by id
  const pending = () => host["callbacks"].size + host["served"].size;
  return { host, r, out, send, pending };
};

// the kinds of the responses to call parentId
const responses = (out: Call[], parentId: number | bigint) =>
  out
    .filter((c) => c.method === "CALLBACK" && c.parentId === BigInt(parentId))
    .map((c) => Call_Kind[c.kind]);

const cancels = (out: Call[]) =>
  out.filter((c) => c.method === "CANCEL").map((c) => [c.parentId, Call_Kind[c.kind]]);

// collects unhandled rejections and uncaught exceptions during each test
let processErrors: unknown[] = [];
const onProcessError = (e: unknown) => processErrors.push(e);
beforeEach(function () {
  processErrors = [];
  process.on("unhandledRejection", onProcessError);
  process.on("uncaughtException", onProcessError);
});
afterEach(function () {
  process.off("unhandledRejection", onProcessError);
  process.off("uncaughtException", onProcessError);
});
const assertNoProcessErrors = () => assert.deepStrictEqual(processErrors.map(String), []);

// a service whose "echo" answers a TestMessage with itself, recording each
const echoService = () => {
  const seen: TestMessage[] = [];
  const service = new ServiceRegistry();
  service.registerMethod(
    "echo",
    (req: TestMessage) => {
      seen.push(req);
      return req;
    },
    TestMessage
  );
  return { service, seen };
};

describe("Host", function () {
  describe("framing", function () {
    const big = (n: number) => {
      const bytesValue = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytesValue[i] = i * 7;
      return new TestMessage({ bytesValue });
    };

    it("reassembles a frame split across chunks", async function () {
      const { service, seen } = echoService();
      const { host, out } = connect(service);
      const f = frame(request(1, "echo", big(100000)));
      host["handleData"](f.subarray(0, 65536));
      assert.strictEqual(seen.length, 0);
      host["handleData"](f.subarray(65536));
      await sleep(5);
      assert.strictEqual(seen.length, 1);
      assert.deepStrictEqual(seen[0], big(100000));
      assert.deepStrictEqual(responses(out, 1), ["CALL_KIND_DEFAULT"]);
      assert.strictEqual(out.length, 1);
    });

    it("reassembles frames from the chunks a pipe gave a 200 KB write", async function () {
      const { service, seen } = echoService();
      const { host, out } = connect(service);
      const f1 = frame(request(1, "echo", big(100000)));
      const f2 = frame(request(2, "echo", big(99990)));
      const buf = new Uint8Array(f1.length + f2.length);
      buf.set(f1);
      buf.set(f2, f1.length);
      let pos = 0;
      for (const n of [65536, 65536, 15104]) {
        host["handleData"](buf.subarray(pos, (pos += n)));
      }
      host["handleData"](buf.subarray(pos));
      await sleep(5);
      assert.deepStrictEqual(seen, [big(100000), big(99990)]);
      assert.deepStrictEqual(
        out.map((c) => [c.parentId, Call_Kind[c.kind]]),
        [
          [BigInt(1), "CALL_KIND_DEFAULT"],
          [BigInt(2), "CALL_KIND_DEFAULT"],
        ]
      );
    });

    it("reassembles frames fed a byte at a time", async function () {
      const { service, seen } = echoService();
      const { host, out } = connect(service);
      const frames = [1, 2, 3].map((id) => frame(request(id, "echo", big(200 * id))));
      for (const f of frames) {
        for (let i = 0; i < f.length; i++) {
          host["handleData"](f.subarray(i, i + 1));
        }
      }
      await sleep(5);
      assert.deepStrictEqual(seen, [big(200), big(400), big(600)]);
      assert.strictEqual(out.length, 3);
    });

    it("dispatches every frame in a chunk, in order", async function () {
      const { service, seen } = echoService();
      const { host, out } = connect(service);
      const frames = [1, 2, 3].map((id) => frame(request(id, "echo", big(id))));
      const buf = new Uint8Array(frames.reduce((n, f) => n + f.length, 0));
      let pos = 0;
      for (const f of frames) {
        buf.set(f, pos);
        pos += f.length;
      }
      host["handleData"](buf);
      await sleep(5);
      assert.deepStrictEqual(seen, [big(1), big(2), big(3)]);
      assert.deepStrictEqual(
        out.map((c) => c.parentId),
        [BigInt(1), BigInt(2), BigInt(3)]
      );
    });

    it("takes ArrayBuffer and offset Uint8Array chunks", async function () {
      const { service, seen } = echoService();
      const { host } = connect(service);
      const f = frame(request(1, "echo", big(10)));
      const padded = new Uint8Array(f.length + 8);
      padded.set(f, 4);
      host["handleData"](padded.subarray(4, 10));
      host["handleData"](padded.slice(10, 4 + f.length).buffer);
      await sleep(5);
      assert.deepStrictEqual(seen, [big(10)]);
    });

    it("drops a frame that doesn't decode, and serves the next", async function () {
      const { service, seen } = echoService();
      const { host, out } = connect(service);
      const junk = new Uint8Array([3, 0xff, 0xff, 0xff]);
      const good = frame(request(1, "echo", big(5)));
      const buf = new Uint8Array(junk.length + good.length);
      buf.set(junk);
      buf.set(good, junk.length);
      assert.doesNotThrow(() => host["handleData"](buf));
      await sleep(5);
      assert.deepStrictEqual(seen, [big(5)]);
      assert.deepStrictEqual(responses(out, 1), ["CALL_KIND_DEFAULT"]);
      assert.strictEqual(out.length, 1);
    });

    it("keeps dispatching frames after a listener throws", async function () {
      const { host } = connect();
      const stream = host.expectMany(
        host.call("stream", new RPCCallStreamRequest()),
        RPCCallStreamResponse
      );
      const unary = host.expectOne(
        host.call("unary", new RPCCallUnaryRequest()),
        RPCCallUnaryResponse
      );
      stream.on("data", () => {
        throw new Error("listener bug");
      });
      await sleep(5);

      // mocha fails a test on an uncaught exception: let this one through
      const mochaListeners = process.listeners("uncaughtException");
      process.removeAllListeners("uncaughtException");
      process.on("uncaughtException", onProcessError);
      try {
        const both = new Uint8Array([
          ...frame(callback(BigInt(1), DEFAULT, new RPCCallStreamResponse({ id: BigInt(1) }))),
          ...frame(callback(BigInt(2), DEFAULT, new RPCCallUnaryResponse({ id: BigInt(2) }))),
        ]);
        assert.doesNotThrow(() => host["handleData"](both));
        assert.deepStrictEqual(await unary, new RPCCallUnaryResponse({ id: BigInt(2) }));
        await sleep(5);
      } finally {
        process.removeAllListeners("uncaughtException");
        for (const l of mochaListeners) process.on("uncaughtException", l);
      }
      assert.deepStrictEqual(processErrors.map(String), ["Error: listener bug"]);
      processErrors = [];
    });

    it("round-trips 200 KB frames through a child process's pipes", async function () {
      this.timeout(20000);
      const child = spawn(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"]);
      child.stdin.on("error", () => undefined);
      const chunks: number[] = [];
      child.stdout.on("data", (b: Uint8Array) => chunks.push(b.length));
      try {
        // the host answers its own calls, which the child echoes back
        const { service } = echoService();
        const host = new Host(child.stdin, child.stdout, service);
        const req = big(200000);
        const res = await host.expectOne(host.call("echo", req), TestMessage, { timeout: 15000 });
        assert.deepStrictEqual(res, req);
        assert.ok(chunks.length > 2, `the pipe gave ${chunks.length} chunks`);
      } finally {
        child.kill();
      }
    });
  });

  describe("serving", function () {
    const serve = (callback: (req: RPCCallUnaryRequest) => unknown) => {
      const service = new ServiceRegistry();
      service.registerMethod<RPCCallUnaryRequest, unknown>("m", callback, RPCCallUnaryRequest);
      return connect(service);
    };

    const error = (out: Call[]) => {
      const res = out.filter((c) => c.kind === ERROR);
      assert.strictEqual(res.length, 1);
      return RPCError.decode(res[0].argument);
    };

    it("answers a rejecting async handler with ERROR, leaving no unhandled rejection", async function () {
      const { out, send } = serve(() =>
        Promise.reject(Object.assign(new Error("boom"), { code: 4000 }))
      );
      send(request(1, "m", new RPCCallUnaryRequest()));
      await sleep(10);
      assert.deepStrictEqual(responses(out, 1), ["CALL_KIND_ERROR"]);
      assert.deepStrictEqual(error(out), new RPCError({ message: "boom", code: 4000 }));
      assertNoProcessErrors();
    });

    it("answers a throwing handler with ERROR", async function () {
      const { out, send } = serve(() => {
        throw Object.assign(new Error("bang"), { code: 7 });
      });
      send(request(1, "m", new RPCCallUnaryRequest()));
      await sleep(5);
      assert.deepStrictEqual(error(out), new RPCError({ message: "bang", code: 7 }));
    });

    it("answers an async handler that resolves undefined with UNDEFINED", async function () {
      const { out, send, pending } = serve(() => Promise.resolve(undefined));
      send(request(1, "m", new RPCCallUnaryRequest()));
      await sleep(10);
      assert.deepStrictEqual(responses(out, 1), ["CALL_KIND_UNDEFINED"]);
      assert.strictEqual(pending(), 0);
      assertNoProcessErrors();
    });

    it("answers a resolved value with DEFAULT, and a resolved rpc.Error with ERROR", async function () {
      const { out, send } = serve((req) =>
        Promise.resolve(
          req.id
            ? new RPCCallUnaryResponse({ id: req.id })
            : new RPCError({ message: "no", code: 3 })
        )
      );
      send(
        request(1, "m", new RPCCallUnaryRequest({ id: BigInt(9) })),
        request(2, "m", new RPCCallUnaryRequest())
      );
      await sleep(10);
      assert.deepStrictEqual(responses(out, 1), ["CALL_KIND_DEFAULT"]);
      assert.deepStrictEqual(RPCCallUnaryResponse.decode(out[0].argument).id, BigInt(9));
      assert.deepStrictEqual(responses(out, 2), ["CALL_KIND_ERROR"]);
      assert.deepStrictEqual(error(out), new RPCError({ message: "no", code: 3 }));
    });

    for (const [name, result] of [
      ["sync", () => ({ id: BigInt(1) })],
      ["async", () => Promise.resolve({ id: BigInt(1) })],
    ] as const) {
      it(`answers a ${name} result that won't encode with ERROR`, async function () {
        const { out, send } = serve(result);
        send(request(1, "m", new RPCCallUnaryRequest()));
        await sleep(10);
        assert.deepStrictEqual(responses(out, 1), ["CALL_KIND_ERROR"]);
        assert.match(error(out).message, /encode/);
        assertNoProcessErrors();
      });
    }

    it("answers an unknown method with ERROR", async function () {
      const { out, send } = serve(() => new RPCCallUnaryResponse());
      send(
        request(1, "nope", new RPCCallUnaryRequest()),
        request(2, "toString", new RPCCallUnaryRequest())
      );
      await sleep(5);
      assert.deepStrictEqual(
        out.map((c) => [c.parentId, RPCError.decode(c.argument).message]),
        [
          [BigInt(1), "method not implemented: nope"],
          [BigInt(2), "method not implemented: toString"],
        ]
      );
    });

    it("answers a request whose argument doesn't decode with ERROR", async function () {
      const { out, send } = serve(() => new RPCCallUnaryResponse());
      send({ id: BigInt(1), method: "m", argument: new Uint8Array([0x08]) });
      await sleep(5);
      assert.match(error(out).message, /index out of range/);
    });
  });

  describe("served streams", function () {
    // serves "s" with the stream streams() returns, recording it
    const serveStream = (stream: () => PassThrough) => {
      const streams: PassThrough[] = [];
      const service = new ServiceRegistry();
      service.registerMethod(
        "s",
        () => {
          const s = stream();
          streams.push(s);
          return s;
        },
        RPCCallStreamRequest
      );
      return { ...connect(service), streams };
    };

    const item = (id: number) => new RPCCallStreamResponse({ id: BigInt(id) });

    it("sends its items and one CLOSE when it ends", async function () {
      const { out, send, streams, pending } = serveStream(
        () => new PassThrough({ objectMode: true })
      );
      send(request(1, "s", new RPCCallStreamRequest()));
      await sleep(5);
      streams[0].write(item(1));
      streams[0].write(item(2));
      streams[0].end();
      await sleep(10);
      assert.deepStrictEqual(responses(out, 1), [
        "CALL_KIND_DEFAULT",
        "CALL_KIND_DEFAULT",
        "CALL_KIND_CLOSE",
      ]);
      assert.strictEqual(pending(), 0);
    });

    it("sends one CLOSE when it ends without a close event, as in browsers", async function () {
      const { out, send, streams } = serveStream(
        () => new PassThrough({ objectMode: true, autoDestroy: false })
      );
      const closed: string[] = [];
      send(request(1, "s", new RPCCallStreamRequest()));
      await sleep(5);
      streams[0].on("close", () => closed.push("close"));
      streams[0].end(item(1));
      await sleep(10);
      assert.deepStrictEqual(closed, []);
      assert.deepStrictEqual(responses(out, 1), ["CALL_KIND_DEFAULT", "CALL_KIND_CLOSE"]);
    });

    it("sends one CLOSE when it is destroyed without an error", async function () {
      const { out, send, streams } = serveStream(() => new PassThrough({ objectMode: true }));
      send(request(1, "s", new RPCCallStreamRequest()));
      await sleep(5);
      streams[0].write(item(1));
      streams[0].destroy();
      await sleep(10);
      assert.deepStrictEqual(responses(out, 1), ["CALL_KIND_DEFAULT", "CALL_KIND_CLOSE"]);
    });

    it("sends one ERROR, and no CLOSE, when it errors", async function () {
      const { out, send, streams, pending } = serveStream(
        () => new PassThrough({ objectMode: true })
      );
      send(request(1, "s", new RPCCallStreamRequest()));
      await sleep(5);
      streams[0].write(item(1));
      streams[0].destroy(Object.assign(new Error("disk on fire"), { code: 12 }));
      await sleep(10);
      assert.deepStrictEqual(responses(out, 1), ["CALL_KIND_DEFAULT", "CALL_KIND_ERROR"]);
      assert.deepStrictEqual(
        RPCError.decode(out[1].argument),
        new RPCError({ message: "disk on fire", code: 12 })
      );
      assert.strictEqual(pending(), 0);
      assertNoProcessErrors();
    });

    it("sends ERROR for an item that won't encode, and destroys the stream", async function () {
      const { out, send, streams } = serveStream(() => new PassThrough({ objectMode: true }));
      send(request(1, "s", new RPCCallStreamRequest()));
      await sleep(5);
      streams[0].write(item(1));
      streams[0].write({ id: BigInt(2) });
      streams[0].write(item(3));
      await sleep(10);
      assert.deepStrictEqual(responses(out, 1), ["CALL_KIND_DEFAULT", "CALL_KIND_ERROR"]);
      assert.ok(streams[0].destroyed);
    });

    for (const kind of [CANCEL, DEFAULT]) {
      it(`stops on a CANCEL of ${Call_Kind[kind]}`, async function () {
        let iid: ReturnType<typeof setInterval>;
        const { out, send, streams, pending } = serveStream(() => {
          const s = new PassThrough({ objectMode: true });
          let n = 0;
          iid = setInterval(() => s.write(item(++n)), 2);
          s.on("close", () => clearInterval(iid));
          return s;
        });
        try {
          send(request(1, "s", new RPCCallStreamRequest()));
          await sleep(20);
          send(cancel(1, kind));
          await sleep(5);
          const sent = out.length;
          assert.ok(sent > 0);
          await sleep(30);
          assert.ok(streams[0].destroyed);
          assert.strictEqual(out.length, sent);
          assert.ok(!responses(out, 1).includes("CALL_KIND_CLOSE"));
          assert.strictEqual(pending(), 0);
        } finally {
          clearInterval(iid);
        }
      });
    }

    it("drops a cancelled unary call's late result", async function () {
      const service = new ServiceRegistry();
      service.registerMethod(
        "slow",
        () => sleep(20).then(() => new RPCCallUnaryResponse()),
        RPCCallUnaryRequest
      );
      const { out, send, pending } = connect(service);
      send(request(1, "slow", new RPCCallUnaryRequest()));
      await sleep(5);
      send(cancel(1, DEFAULT));
      await sleep(40);
      assert.deepStrictEqual(out, []);
      assert.strictEqual(pending(), 0);
    });

    it("ignores a CANCEL or CALLBACK for a call it doesn't know", async function () {
      const { out, send } = serveStream(() => new PassThrough({ objectMode: true }));
      send(cancel(5, CANCEL), cancel(5, DEFAULT), callback(BigInt(5), DEFAULT));
      await sleep(5);
      assert.deepStrictEqual(out, []);
      assertNoProcessErrors();
    });

    for (const how of ["end", "close", "error"] as const) {
      it(`cancels served calls when the connection's readable side gets ${how}`, async function () {
        const service = new ServiceRegistry();
        const streams: PassThrough[] = [];
        service.registerMethod(
          "s",
          () => {
            const s = new PassThrough({ objectMode: true });
            streams.push(s);
            return s;
          },
          RPCCallStreamRequest
        );
        service.registerMethod(
          "slow",
          () => sleep(20).then(() => new RPCCallUnaryResponse()),
          RPCCallUnaryRequest
        );
        const { r, out, send, pending } = connect(service);
        send(
          request(1, "s", new RPCCallStreamRequest()),
          request(2, "slow", new RPCCallUnaryRequest())
        );
        await sleep(5);
        streams[0].write(item(1));
        await sleep(5);
        r.on("error", () => undefined);
        if (how === "end") r.end();
        else if (how === "close") r.destroy();
        else r.destroy(new Error("reset"));
        await sleep(30);
        assert.ok(streams[0].destroyed);
        assert.deepStrictEqual(responses(out, 1), ["CALL_KIND_DEFAULT"]);
        assert.deepStrictEqual(responses(out, 2), []);
        assert.strictEqual(pending(), 0);
      });
    }
  });

  describe("calls", function () {
    const unary = (host: Host, opts?: { timeout?: number }) => {
      const call = host.call("m", new RPCCallUnaryRequest());
      return host.expectOne(call, RPCCallUnaryResponse, opts);
    };

    it("resolves on DEFAULT", async function () {
      const { host, send, pending } = connect();
      const p = unary(host);
      send(callback(BigInt(1), DEFAULT, new RPCCallUnaryResponse({ id: BigInt(5) })));
      assert.deepStrictEqual(await p, new RPCCallUnaryResponse({ id: BigInt(5) }));
      assert.strictEqual(pending(), 0);
    });

    it("rejects with the rpc.Error on ERROR", async function () {
      const { host, send, pending } = connect();
      const p = unary(host);
      send(callback(BigInt(1), ERROR, new RPCError({ message: "nope", code: 4001 })));
      const e = await p.then(
        () => assert.fail("resolved"),
        (e: unknown) => e
      );
      assert.ok(e instanceof RPCError);
      assert.strictEqual(e.code, 4001);
      assert.strictEqual(e.message, "nope");
      assert.strictEqual(pending(), 0);
    });

    for (const kind of [UNDEFINED, CLOSE, CANCEL]) {
      it(`rejects on ${Call_Kind[kind]}, which a unary call can't take`, async function () {
        const { host, send, pending } = connect();
        const p = unary(host, { timeout: 50 });
        send(callback(BigInt(1), kind));
        await assert.rejects(p, new Error(`rpc: unexpected response kind ${Call_Kind[kind]}`));
        assert.strictEqual(pending(), 0);
      });
    }

    it("rejects when the response doesn't decode", async function () {
      const { host, send } = connect();
      const p = unary(host);
      send({ ...callback(BigInt(1), DEFAULT), argument: new Uint8Array([0x08]) });
      await assert.rejects(p, /index out of range/);
    });

    it("rejects with undefined on a timeout, and cancels the call", async function () {
      const { host, out, send, pending } = connect();
      const p = unary(host, { timeout: 20 });
      const reason = await p.then(
        () => assert.fail("resolved"),
        (e: unknown) => ({ e })
      );
      assert.deepStrictEqual(reason, { e: undefined });
      assert.strictEqual(pending(), 0);
      await sleep(5);
      assert.deepStrictEqual(cancels(out), [[BigInt(1), "CALL_KIND_CANCEL"]]);
      // a late response is dropped
      send(callback(BigInt(1), DEFAULT, new RPCCallUnaryResponse()));
      await sleep(5);
      assertNoProcessErrors();
    });

    for (const timeout of [0, Infinity, -1, 2 ** 31, undefined]) {
      it(`has no timeout yet after 50ms when timeout is ${timeout}`, async function () {
        const { host, out, send } = connect();
        const p = unary(host, { timeout });
        assert.strictEqual(await state(p, 50), "pending");
        send(callback(BigInt(1), DEFAULT, new RPCCallUnaryResponse({ id: BigInt(1) })));
        assert.deepStrictEqual(await p, new RPCCallUnaryResponse({ id: BigInt(1) }));
        assert.deepStrictEqual(cancels(out), []);
      });
    }

    it("doesn't take a CANCEL of the peer's call for one of its own", async function () {
      // the peer cancels its call 1, as a Go client does: CALL_KIND_DEFAULT
      const { host, send } = connect();
      const p = unary(host);
      send(cancel(1, DEFAULT), cancel(1, CANCEL));
      assert.strictEqual(await state(p), "pending");
      send(callback(BigInt(1), DEFAULT, new RPCCallUnaryResponse({ id: BigInt(3) })));
      assert.deepStrictEqual(await p, new RPCCallUnaryResponse({ id: BigInt(3) }));
    });

    describe("streams", function () {
      const stream = (host: Host) =>
        host.expectMany(host.call("s", new RPCCallStreamRequest()), RPCCallStreamResponse);
      const item = (id: number) => new RPCCallStreamResponse({ id: BigInt(id) });

      it("ends on CLOSE, and emits close", async function () {
        const { host, out, send, pending } = connect();
        const s = stream(host);
        const closed = new Promise<void>((resolve) => s.on("close", resolve));
        send(callback(BigInt(1), DEFAULT, item(1)), callback(BigInt(1), DEFAULT, item(2)));
        send(callback(BigInt(1), CLOSE));
        const items: RPCCallStreamResponse[] = [];
        for await (const v of s) items.push(v);
        assert.deepStrictEqual(items, [item(1), item(2)]);
        await closed;
        assert.deepStrictEqual(cancels(out), []);
        assert.strictEqual(pending(), 0);
      });

      it("cancels once when the consumer stops early", async function () {
        const { host, out, send, pending } = connect();
        const s = stream(host);
        send(callback(BigInt(1), DEFAULT, item(1)));
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of s) break;
        await sleep(5);
        assert.deepStrictEqual(cancels(out), [[BigInt(1), "CALL_KIND_CANCEL"]]);
        assert.strictEqual(pending(), 0);
        // the server's items in flight are dropped
        send(callback(BigInt(1), DEFAULT, item(2)));
        await sleep(5);
        assert.strictEqual(cancels(out).length, 1);
      });

      it("errors with the rpc.Error on ERROR, then closes", async function () {
        const { host, out, send, pending } = connect();
        const s = stream(host);
        const events: string[] = [];
        const errored = new Promise<unknown>((resolve) => s.on("error", resolve));
        s.on("close", () => events.push("close"));
        send(callback(BigInt(1), ERROR, new RPCError({ message: "gone", code: 9 })));
        const e = await errored;
        assert.ok(e instanceof RPCError);
        assert.strictEqual(e.code, 9);
        await sleep(5);
        assert.deepStrictEqual(events, ["close"]);
        assert.deepStrictEqual(cancels(out), []);
        assert.strictEqual(pending(), 0);
      });

      it("errors on UNDEFINED, which a stream can't take", async function () {
        const { host, out, send, pending } = connect();
        const s = stream(host);
        const errored = new Promise<unknown>((resolve) => s.on("error", resolve));
        send(callback(BigInt(1), UNDEFINED));
        assert.deepStrictEqual(
          await errored,
          new Error("rpc: unexpected response kind CALL_KIND_UNDEFINED")
        );
        await sleep(5);
        assert.deepStrictEqual(cancels(out), []);
        assert.strictEqual(pending(), 0);
      });

      it("errors, and cancels, when an item doesn't decode", async function () {
        const { host, out, send, pending } = connect();
        const s = stream(host);
        const errored = new Promise<Error>((resolve) => s.on("error", resolve));
        send({ ...callback(BigInt(1), DEFAULT), argument: new Uint8Array([0x08]) });
        assert.match((await errored).message, /index out of range/);
        await sleep(5);
        assert.deepStrictEqual(cancels(out), [[BigInt(1), "CALL_KIND_CANCEL"]]);
        assert.strictEqual(pending(), 0);
      });
    });

    for (const how of ["end", "close", "error"] as const) {
      it(`fails pending calls when the readable side gets ${how}`, async function () {
        const { host, r, out, pending } = connect();
        const p = unary(host);
        const s = host.expectMany(
          host.call("s", new RPCCallStreamRequest()),
          RPCCallStreamResponse
        );
        const errored = new Promise<unknown>((resolve) => s.on("error", resolve));
        await sleep(5);
        r.on("error", () => undefined);
        if (how === "end") r.end();
        else if (how === "close") r.destroy();
        else r.destroy(new Error("reset"));

        await assert.rejects(p, new Error("rpc: connection closed"));
        assert.deepStrictEqual(await errored, new Error("rpc: connection closed"));
        assert.strictEqual(pending(), 0);

        // and later calls at once
        await assert.rejects(unary(host), new Error("rpc: connection closed"));
        const later = host.expectMany(
          host.call("s", new RPCCallStreamRequest()),
          RPCCallStreamResponse
        );
        assert.deepStrictEqual(
          await new Promise((resolve) => later.on("error", resolve)),
          new Error("rpc: connection closed")
        );
        await sleep(5);
        assert.deepStrictEqual(cancels(out), []);
        assert.strictEqual(pending(), 0);
      });
    }
  });

  describe("between two hosts", function () {
    // a and b each serve "echo" and "count", and call each other
    const pair = () => {
      const services = [0, 1].map(() => {
        const service = new ServiceRegistry();
        const streams: PassThrough[] = [];
        service.registerMethod(
          "echo",
          (req: RPCCallUnaryRequest) => new RPCCallUnaryResponse({ id: req.id }),
          RPCCallUnaryRequest
        );
        service.registerMethod(
          "count",
          (req: RPCCallStreamRequest) => {
            const s = new PassThrough({ objectMode: true });
            streams.push(s);
            let n = 0;
            const iid = setInterval(() => {
              s.write(new RPCCallStreamResponse({ id: BigInt(++n) }));
              if (req.count && n >= req.count) {
                clearInterval(iid);
                s.end();
              }
            }, 1);
            s.on("close", () => clearInterval(iid));
            return s;
          },
          RPCCallStreamRequest
        );
        return { service, streams };
      });
      const [ab, ba] = [new PassThrough(), new PassThrough()];
      const a = new Host(ab, ba, services[0].service);
      const b = new Host(ba, ab, services[1].service);
      return { a, b, aStreams: services[0].streams, bStreams: services[1].streams };
    };

    const echo = (host: Host, id: number) =>
      host.expectOne(
        host.call("echo", new RPCCallUnaryRequest({ id: BigInt(id) })),
        RPCCallUnaryResponse
      );

    it("answers calls both ways with colliding ids", async function () {
      const { a, b } = pair();
      // both hosts' first calls are id 1
      const res = await Promise.all([echo(a, 10), echo(b, 20), echo(a, 11), echo(b, 21)]);
      assert.deepStrictEqual(
        res.map((r) => r.id),
        [10, 20, 11, 21].map((n) => BigInt(n))
      );
      assert.strictEqual(a["callbacks"].size + a["served"].size, 0);
      assert.strictEqual(b["callbacks"].size + b["served"].size, 0);
    });

    it("streams, and cancels a stream the consumer stops reading", async function () {
      const { a, b, bStreams } = pair();
      const full = a.expectMany(
        a.call("count", new RPCCallStreamRequest({ count: BigInt(3) })),
        RPCCallStreamResponse
      );
      const ids: bigint[] = [];
      for await (const v of full) ids.push(v.id);
      assert.deepStrictEqual(
        ids,
        [1, 2, 3].map((n) => BigInt(n))
      );

      const endless = a.expectMany(
        a.call("count", new RPCCallStreamRequest()),
        RPCCallStreamResponse
      );
      let n = 0;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of endless) if (++n === 3) break;
      await sleep(10);
      assert.ok(bStreams[1].destroyed);
      assert.strictEqual(a["callbacks"].size + a["served"].size, 0);
      assert.strictEqual(b["callbacks"].size + b["served"].size, 0);
      assertNoProcessErrors();
    });
  });
});
