import assert from "assert";
import { spawn } from "child_process";
import Module from "module";
import { PassThrough, Writable } from "stream";

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

// Loads another copy of host.ts, whose "stream" is streamModule.
const loadHost = (streamModule: string): typeof Host => {
  // loaded first, so its own requires resolve as usual
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(streamModule);
  const resolver = Module as unknown as {
    _resolveFilename: (request: string, ...rest: unknown[]) => string;
  };
  const resolve = resolver._resolveFilename;
  const hostPath = require.resolve("./host");
  const cached = require.cache[hostPath];
  delete require.cache[hostPath];
  resolver._resolveFilename = function (this: unknown, request: string, ...rest: unknown[]) {
    // (call is untyped here: the repo's tsconfig isn't strict)
    return resolve.call(this, request === "stream" ? streamModule : request, ...rest) as string;
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require("./host") as { default: typeof Host }).default;
  } finally {
    resolver._resolveFilename = resolve;
    require.cache[hostPath] = cached;
  }
};

// Node's streams, and the readable-stream 3 that browsers get (strims bundles
// stream-browserify as "stream"), each with a Host built on them.
interface StreamImpl {
  name: string;
  PassThrough: typeof PassThrough;
  Host: typeof Host;
}
const browserStream = require.resolve("stream-browserify");
const impls: StreamImpl[] = [
  { name: "Node streams", PassThrough, Host },
  {
    name: "readable-stream 3",
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    PassThrough: (require(browserStream) as { PassThrough: typeof PassThrough }).PassThrough,
    Host: loadHost(browserStream),
  },
];

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
const connect = (service?: ServiceRegistry, impl = impls[0]) => {
  const w = new impl.PassThrough();
  const r = new impl.PassThrough();
  const out: Call[] = [];
  w.on("data", (b: Uint8Array) => {
    const reader = new Reader(b);
    while (reader.pos < reader.len) {
      out.push(Call.decode(reader, reader.uint32()));
    }
  });
  const host = new impl.Host(w, r, service);
  const send = (...calls: ICall[]) => {
    for (const c of calls) {
      r.write(frame(c));
    }
  };
  // writes the frames as one chunk, as a pipe may join them
  const sendJoined = (...calls: ICall[]) => {
    const frames = calls.map(frame);
    const buf = new Uint8Array(frames.reduce((n, f) => n + f.length, 0));
    let pos = 0;
    for (const f of frames) {
      buf.set(f, pos);
      pos += f.length;
    }
    r.write(buf);
  };
  // the calls a test's handlers and streams hold on to, by id
  const pending = () => host["callbacks"].size + host["served"].size;
  return { host, w, r, out, send, sendJoined, pending };
};

// Runs fn with mocha's uncaught exception handler off, returning the uncaught
// exceptions instead.
const uncaught = async (fn: () => Promise<void>): Promise<unknown[]> => {
  const caught: unknown[] = [];
  const onError = (e: unknown) => caught.push(e);
  const listeners = process.listeners("uncaughtException");
  process.removeAllListeners("uncaughtException");
  process.on("uncaughtException", onError);
  try {
    await fn();
  } finally {
    process.removeAllListeners("uncaughtException");
    for (const l of listeners) process.on("uncaughtException", l);
  }
  return caught;
};

// a stream's items, and the error it ended with; ms between reads
const readAll = async <T>(s: AsyncIterable<T>, ms = 0) => {
  const items: T[] = [];
  try {
    for await (const v of s) {
      items.push(v);
      if (ms) await sleep(ms);
    }
  } catch (e) {
    return { items, err: e as unknown };
  }
  return { items, err: undefined as unknown };
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

      const caught = await uncaught(async () => {
        const both = new Uint8Array([
          ...frame(callback(BigInt(1), DEFAULT, new RPCCallStreamResponse({ id: BigInt(1) }))),
          ...frame(callback(BigInt(2), DEFAULT, new RPCCallUnaryResponse({ id: BigInt(2) }))),
        ]);
        assert.doesNotThrow(() => host["handleData"](both));
        assert.deepStrictEqual(await unary, new RPCCallUnaryResponse({ id: BigInt(2) }));
        await sleep(5);
      });
      assert.deepStrictEqual(caught.map(String), ["Error: listener bug"]);
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

  for (const impl of impls) {
    describe(`served streams, on ${impl.name}`, function () {
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
        return { ...connect(service, impl), streams };
      };

      const item = (id: number) => new RPCCallStreamResponse({ id: BigInt(id) });

      it("sends its items and one CLOSE when it ends", async function () {
        const { out, send, streams, pending } = serveStream(
          () => new impl.PassThrough({ objectMode: true })
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
          () => new impl.PassThrough({ objectMode: true, autoDestroy: false })
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
        const { out, send, streams } = serveStream(
          () => new impl.PassThrough({ objectMode: true })
        );
        send(request(1, "s", new RPCCallStreamRequest()));
        await sleep(5);
        streams[0].write(item(1));
        streams[0].destroy();
        await sleep(10);
        assert.deepStrictEqual(responses(out, 1), ["CALL_KIND_DEFAULT", "CALL_KIND_CLOSE"]);
      });

      it("sends one ERROR, and no CLOSE, when it errors", async function () {
        const { out, send, streams, pending } = serveStream(
          () => new impl.PassThrough({ objectMode: true })
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
        const { out, send, streams } = serveStream(
          () => new impl.PassThrough({ objectMode: true })
        );
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
            const s = new impl.PassThrough({ objectMode: true });
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
        const { out, send, pending } = connect(service, impl);
        send(request(1, "slow", new RPCCallUnaryRequest()));
        await sleep(5);
        send(cancel(1, DEFAULT));
        await sleep(40);
        assert.deepStrictEqual(out, []);
        assert.strictEqual(pending(), 0);
      });

      it("ignores a CANCEL or CALLBACK for a call it doesn't know", async function () {
        const { out, send } = serveStream(() => new impl.PassThrough({ objectMode: true }));
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
              const s = new impl.PassThrough({ objectMode: true });
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
          const { r, out, send, pending } = connect(service, impl);
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

      // serves "s" with what handler returns, recording the streams it makes
      const serveAsync = (handler: (streams: PassThrough[]) => Promise<PassThrough>) => {
        const streams: PassThrough[] = [];
        const service = new ServiceRegistry();
        service.registerMethod("s", () => handler(streams), RPCCallStreamRequest);
        return { ...connect(service, impl), streams };
      };

      // a stream, made after a wait, that sends items until it's destroyed
      const ticker = async (streams: PassThrough[]) => {
        await sleep(20);
        const s = new impl.PassThrough({ objectMode: true });
        streams.push(s);
        let n = 0;
        const iid = setInterval(() => s.write(item(++n)), 2);
        s.on("close", () => clearInterval(iid));
        return s;
      };

      it("destroys a stream its handler's promise gives after a CANCEL", async function () {
        const { out, send, streams, pending } = serveAsync(ticker);
        send(request(1, "s", new RPCCallStreamRequest()));
        await sleep(5);
        send(cancel(1, CANCEL));
        await sleep(30);
        assert.strictEqual(streams.length, 1);
        assert.ok(streams[0].destroyed);
        assert.deepStrictEqual(out, []);
        assert.strictEqual(pending(), 0);
      });

      it("destroys a stream its handler's promise gives after the connection closes", async function () {
        const { r, out, send, streams, pending } = serveAsync(ticker);
        send(request(1, "s", new RPCCallStreamRequest()));
        await sleep(5);
        r.end();
        await sleep(30);
        assert.strictEqual(streams.length, 1);
        assert.ok(streams[0].destroyed);
        assert.deepStrictEqual(out, []);
        assert.strictEqual(pending(), 0);
      });

      it("sends one CLOSE for a stream destroyed before its handler returned it", async function () {
        const { out, send, pending } = serveAsync(async () => {
          const s = new impl.PassThrough({ objectMode: true });
          s.destroy();
          await sleep(5);
          return s;
        });
        send(request(1, "s", new RPCCallStreamRequest()));
        await sleep(20);
        assert.deepStrictEqual(responses(out, 1), ["CALL_KIND_CLOSE"]);
        assert.strictEqual(pending(), 0);
      });

      it("sends one CLOSE for a stream that ended before its handler returned it", async function () {
        const { out, send, pending } = serveAsync(async () => {
          const s = new impl.PassThrough({ objectMode: true, autoDestroy: false });
          s.resume();
          s.end();
          await sleep(5);
          return s;
        });
        send(request(1, "s", new RPCCallStreamRequest()));
        await sleep(20);
        assert.deepStrictEqual(responses(out, 1), ["CALL_KIND_CLOSE"]);
        assert.strictEqual(pending(), 0);
      });

      it("sends one ERROR for a stream its handler destroys with an error as it returns it", async function () {
        const { out, send, pending } = serveStream(() => {
          const s = new impl.PassThrough({ objectMode: true });
          s.destroy(Object.assign(new Error("broken"), { code: 5 }));
          return s;
        });
        send(request(1, "s", new RPCCallStreamRequest()));
        await sleep(20);
        assert.deepStrictEqual(responses(out, 1), ["CALL_KIND_ERROR"]);
        assert.deepStrictEqual(
          RPCError.decode(out[0].argument),
          new RPCError({ message: "broken", code: 5 })
        );
        assert.strictEqual(pending(), 0);
        assertNoProcessErrors();
      });
    });
  }

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

    const timers: [number | undefined, number[]][] = [
      [undefined, [5000]],
      [20, [20]],
      [2 ** 31 - 1, [2 ** 31 - 1]],
      [0, []],
      [Infinity, []],
      [2 ** 31, []],
      [-1, []],
      [NaN, []],
    ];
    for (const [timeout, delays] of timers) {
      it(`sets ${delays.length ? `a ${delays[0]}ms timer` : "no timer"} for timeout ${timeout}`, async function () {
        const { host, send } = connect();
        const set: unknown[] = [];
        const setTimeout_ = global.setTimeout;
        (global as { setTimeout: unknown }).setTimeout = (
          fn: () => void,
          ms?: number
        ): ReturnType<typeof setTimeout> => {
          set.push(ms);
          return setTimeout_(fn, ms);
        };
        let p: Promise<RPCCallUnaryResponse>;
        try {
          p = unary(host, { timeout });
        } finally {
          global.setTimeout = setTimeout_;
        }
        assert.deepStrictEqual(set, delays);
        send(callback(BigInt(1), DEFAULT, new RPCCallUnaryResponse()));
        await p;
      });
    }

    it("waits past the default timeout's first moments with timeout 0", async function () {
      const { host, out, send } = connect();
      const p = unary(host, { timeout: 0 });
      assert.strictEqual(await state(p, 50), "pending");
      send(callback(BigInt(1), DEFAULT, new RPCCallUnaryResponse({ id: BigInt(1) })));
      assert.deepStrictEqual(await p, new RPCCallUnaryResponse({ id: BigInt(1) }));
      assert.deepStrictEqual(cancels(out), []);
    });

    it("delivers a response its write put off when the connection ends in the same tick", async function () {
      const service = new ServiceRegistry();
      service.registerMethod(
        "echo",
        (req: RPCCallUnaryRequest) => new RPCCallUnaryResponse({ id: req.id }),
        RPCCallUnaryRequest
      );
      const [ab, ba] = [new PassThrough(), new PassThrough()];
      const a = new Host(ab, ba);
      new Host(ba, ab, service);
      await sleep(5);
      // from a macrotask, as an event handler would
      const res = await new Promise((resolve) =>
        setTimeout(() => {
          const p = a.expectOne(
            a.call("echo", new RPCCallUnaryRequest({ id: BigInt(7) })),
            RPCCallUnaryResponse
          );
          // the server's side ends right after it answers
          ba.end();
          p.then(
            (v) => resolve(v.id),
            (e: unknown) => resolve(e)
          );
        })
      );
      assert.strictEqual(res, BigInt(7));
    });

    it("writes nothing once the connection has closed", async function () {
      const { host, r, out } = connect();
      r.end();
      await sleep(5);
      await assert.rejects(unary(host), new Error("rpc: connection closed"));
      const s = host.expectMany(host.call("s", new RPCCallStreamRequest()), RPCCallStreamResponse);
      s.on("error", () => undefined);
      await sleep(5);
      assert.deepStrictEqual(out, []);
    });

    it("doesn't write a response again when the write throws", async function () {
      const service = new ServiceRegistry();
      service.registerMethod("m", () => new RPCCallUnaryResponse(), RPCCallUnaryRequest);
      let writes = 0;
      const w = {
        write: () => {
          writes++;
          throw new Error("EPIPE");
        },
      } as unknown as Writable;
      const r = new PassThrough();
      new Host(w, r, service);
      const caught = await uncaught(async () => {
        r.write(frame(request(1, "m", new RPCCallUnaryRequest())));
        await sleep(10);
      });
      assert.strictEqual(writes, 1);
      assert.deepStrictEqual(caught.map(String), ["Error: EPIPE"]);
    });

    it("doesn't take a CANCEL of the peer's call for one of its own", async function () {
      // the peer cancels its call 1, as a Go client does: CALL_KIND_DEFAULT
      const { host, send } = connect();
      const p = unary(host);
      send(cancel(1, DEFAULT), cancel(1, CANCEL));
      assert.strictEqual(await state(p), "pending");
      send(callback(BigInt(1), DEFAULT, new RPCCallUnaryResponse({ id: BigInt(3) })));
      assert.deepStrictEqual(await p, new RPCCallUnaryResponse({ id: BigInt(3) }));
    });
  });

  for (const impl of impls) {
    describe(`client streams, on ${impl.name}`, function () {
      const unary = (host: Host) =>
        host.expectOne(host.call("m", new RPCCallUnaryRequest()), RPCCallUnaryResponse);
      const stream = (host: Host) =>
        host.expectMany(host.call("s", new RPCCallStreamRequest()), RPCCallStreamResponse);
      const item = (id: number) => new RPCCallStreamResponse({ id: BigInt(id) });

      it("ends on CLOSE, and emits close", async function () {
        const { host, out, send, pending } = connect(undefined, impl);
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
        const { host, out, send, pending } = connect(undefined, impl);
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
        const { host, out, send, pending } = connect(undefined, impl);
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
        const { host, out, send, pending } = connect(undefined, impl);
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
        const { host, out, send, pending } = connect(undefined, impl);
        const s = stream(host);
        const errored = new Promise<Error>((resolve) => s.on("error", resolve));
        send({ ...callback(BigInt(1), DEFAULT), argument: new Uint8Array([0x08]) });
        assert.match((await errored).message, /index out of range/);
        await sleep(5);
        assert.deepStrictEqual(cancels(out), [[BigInt(1), "CALL_KIND_CANCEL"]]);
        assert.strictEqual(pending(), 0);
      });

      for (const how of ["end", "close", "error"] as const) {
        it(`fails pending calls when the readable side gets ${how}`, async function () {
          const { host, r, out, pending } = connect(undefined, impl);
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

      const rpcError = new RPCError({ message: "gone", code: 9 });

      it("gives every item before an ERROR that arrives with them", async function () {
        const { host, out, sendJoined, pending } = connect(undefined, impl);
        const s = stream(host);
        sendJoined(
          callback(BigInt(1), DEFAULT, item(1)),
          callback(BigInt(1), DEFAULT, item(2)),
          callback(BigInt(1), ERROR, rpcError)
        );
        const { items, err } = await readAll(s);
        assert.deepStrictEqual(items, [item(1), item(2)]);
        assert.ok(err instanceof RPCError);
        assert.deepStrictEqual(err, rpcError);
        assert.deepStrictEqual(cancels(out), []);
        assert.strictEqual(pending(), 0);
      });

      it("gives every item before an ERROR to a data listener", async function () {
        const { host, sendJoined } = connect(undefined, impl);
        const s = stream(host);
        const items: RPCCallStreamResponse[] = [];
        s.on("data", (v) => items.push(v));
        const errored = new Promise((resolve) => s.on("error", resolve));
        sendJoined(
          callback(BigInt(1), DEFAULT, item(1)),
          callback(BigInt(1), DEFAULT, item(2)),
          callback(BigInt(1), ERROR, rpcError)
        );
        assert.deepStrictEqual(await errored, rpcError);
        assert.deepStrictEqual(items, [item(1), item(2)]);
      });

      it("gives a slow reader every item before a later ERROR", async function () {
        const { host, send } = connect(undefined, impl);
        const s = stream(host);
        void (async () => {
          for (let i = 1; i <= 5; i++) {
            send(callback(BigInt(1), DEFAULT, item(i)));
            await sleep(2);
          }
          send(callback(BigInt(1), ERROR, rpcError));
        })();
        const { items, err } = await readAll(s, 10);
        assert.deepStrictEqual(items, [1, 2, 3, 4, 5].map(item));
        assert.deepStrictEqual(err, rpcError);
      });

      it("gives every item before the connection's close", async function () {
        const { host, r, send, pending } = connect(undefined, impl);
        const s = stream(host);
        send(callback(BigInt(1), DEFAULT, item(1)), callback(BigInt(1), DEFAULT, item(2)));
        await sleep(5);
        r.end();
        await sleep(5);
        const { items, err } = await readAll(s);
        assert.deepStrictEqual(items, [item(1), item(2)]);
        assert.deepStrictEqual(err, new Error("rpc: connection closed"));
        assert.strictEqual(pending(), 0);
      });

      it("gives every item before CLOSE, to a slow reader", async function () {
        const { host, send, pending } = connect(undefined, impl);
        const s = stream(host);
        send(...[1, 2, 3].map((i) => callback(BigInt(1), DEFAULT, item(i))));
        send(callback(BigInt(1), CLOSE));
        const { items, err } = await readAll(s, 5);
        assert.deepStrictEqual(items, [1, 2, 3].map(item));
        assert.strictEqual(err, undefined);
        assert.strictEqual(pending(), 0);
      });

      it("stops at once when the consumer destroys it", async function () {
        const { host, out, send, pending } = connect(undefined, impl);
        const s = stream(host);
        const items: RPCCallStreamResponse[] = [];
        send(...[1, 2, 3].map((i) => callback(BigInt(1), DEFAULT, item(i))));
        await sleep(5);
        s.on("data", (v) => {
          items.push(v);
          s.destroy();
        });
        await sleep(10);
        assert.deepStrictEqual(items, [item(1)]);
        assert.deepStrictEqual(cancels(out), [[BigInt(1), "CALL_KIND_CANCEL"]]);
        assert.strictEqual(pending(), 0);
      });
    });
  }

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
