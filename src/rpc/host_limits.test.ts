import assert from "assert";
import Module from "module";
import { PassThrough, Readable, Writable } from "stream";

import { Call, Call_Kind, Cancel, ICall, Error as RPCError } from "../apis/strims/rpc/rpc";
import { TestMessage } from "../apis/strims/test/message";
import {
  RPCCallStreamRequest,
  RPCCallStreamResponse,
  RPCCallUnaryRequest,
  RPCCallUnaryResponse,
} from "../apis/strims/test/rpc";
import { Message, MessageClass } from "../pb/message";
import Reader from "../pb/reader";
import Writer from "../pb/writer";
import Host, { HostOptions } from "./host";
import ServiceRegistry from "./service";

const { CALL_KIND_DEFAULT: DEFAULT, CALL_KIND_ERROR: ERROR, CALL_KIND_CANCEL: CANCEL } = Call_Kind;

const KiB = 1024;
const MiB = 1024 * KiB;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Loads another copy of host.ts, whose "stream" is streamModule.
const loadHost = (streamModule: string): typeof Host => {
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

// Node's streams, and readable-stream 3, each with a Host built on them.
interface StreamImpl {
  name: string;
  PassThrough: typeof PassThrough;
  Readable: typeof Readable;
  Writable: typeof Writable;
  Host: typeof Host;
}
const browserStream = require.resolve("stream-browserify");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rs3 = require(browserStream) as {
  PassThrough: typeof PassThrough;
  Readable: typeof Readable;
  Writable: typeof Writable;
};
const impls: StreamImpl[] = [
  { name: "Node streams", PassThrough, Readable, Writable, Host },
  { name: "readable-stream 3", ...rs3, Host: loadHost(browserStream) },
];

const encodeArg = (m: unknown): Uint8Array =>
  (m as Message<unknown>).constructor.encode(m, new Writer()).finish().slice();

// a Call's encoding, without and with its length prefix
const body = (c: ICall): Uint8Array => Call.encode(new Call(c), new Writer()).finish().slice();
const frame = (c: ICall): Uint8Array =>
  Call.encode(new Call(c), new Writer().fork()).ldelim().finish().slice();
const prefixed = (b: Uint8Array): Uint8Array => new Writer().bytes(b).finish().slice();

const join = (parts: Uint8Array[]): Uint8Array => {
  const buf = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let pos = 0;
  for (const p of parts) {
    buf.set(p, pos);
    pos += p.byteLength;
  }
  return buf;
};

const request = (id: number, method: string, arg: unknown = new RPCCallUnaryRequest()): ICall => ({
  id: BigInt(id),
  method,
  argument: encodeArg(arg),
});

const callback = (parentId: number, kind: Call_Kind, arg?: unknown): ICall => ({
  id: BigInt(1000),
  parentId: BigInt(parentId),
  method: "CALLBACK",
  kind,
  argument: arg === undefined ? new Uint8Array() : encodeArg(arg),
});

const cancel = (parentId: number): ICall => ({
  id: BigInt(2000),
  parentId: BigInt(parentId),
  method: "CANCEL",
  kind: CANCEL,
  argument: encodeArg(new Cancel()),
});

// n header entries, named h0 to h(n-1), with empty values
const headers = (n: number): Map<string, Uint8Array> => {
  const m = new Map<string, Uint8Array>();
  for (let i = 0; i < n; i++) m.set(`h${i}`, new Uint8Array());
  return m;
};

const withHeaders65 = (c: ICall): ICall => ({ ...c, headers: headers(65) });
const tooManyHeaders = ["CALL_KIND_ERROR", "rpc: too many headers", 0];

// a header entry "k" whose key and value fields come to n bytes
const headerOfBytes = (n: number): Map<string, Uint8Array> => {
  for (let v = n; v >= 0; v--) {
    const entry = new Writer().uint32(10).string("k").uint32(18).bytes(new Uint8Array(v)).finish();
    if (entry.byteLength === n) return new Map([["k", new Uint8Array(v)]]);
  }
  throw new Error(`no ${n}-byte header`);
};

// a DEFAULT response to parentId, a TestMessage, whose Call is n bytes
const sized = (parentId: number, n: number): ICall => {
  for (const id of [1, 300, 70000]) {
    let k = n;
    for (let i = 0; i < 8 && k >= 0; i++) {
      const c = {
        ...callback(parentId, DEFAULT, new TestMessage({ bytesValue: new Uint8Array(k) })),
        id: BigInt(id),
      };
      const len = body(c).byteLength;
      if (len === n) return c;
      k -= len - n;
    }
  }
  throw new Error(`no ${n}-byte response`);
};

// A host, and the peer's side of its connection: the calls the host wrote,
// decoded, and send, which writes it frames. With reading false, w isn't
// read until read() is called.
const connect = (
  impl: StreamImpl,
  {
    service,
    options,
    hwm,
    reading = true,
  }: { service?: ServiceRegistry; options?: HostOptions; hwm?: number; reading?: boolean } = {}
) => {
  const w = new impl.PassThrough(hwm === undefined ? undefined : { highWaterMark: hwm });
  const r = new impl.PassThrough();
  const out: Call[] = [];
  let rest: Uint8Array = new Uint8Array();
  const read = () =>
    w.on("data", (b: Uint8Array) => {
      rest = join([rest, b]);
      const reader = new Reader(rest);
      while (reader.pos < reader.len) {
        const start = reader.pos;
        const len = reader.uint32();
        if (reader.pos + len > reader.len) {
          reader.pos = start;
          break;
        }
        out.push(Call.decode(reader, len));
      }
      rest = rest.slice(reader.pos);
    });
  if (reading) read();
  const closes: unknown[] = [];
  const host = new impl.Host(w, r, service, {
    onClose: (err?: Error) => closes.push(err),
    ...options,
  });
  const send = (...calls: ICall[]) => {
    for (const c of calls) r.write(frame(c));
  };
  const sendRaw = (...frames: Uint8Array[]) => r.write(join(frames));
  // the bytes written to w and not yet read
  const backlog = () => w.writableLength + w.readableLength;
  const serving = () => (host as unknown as { serving: Set<unknown> }).serving.size;
  const callbacks = () => host["callbacks"].size;
  return { host, w, r, out, send, sendRaw, read, closes, backlog, serving, callbacks };
};

// the responses to call parentId, as [kind, message, code]
const responses = (out: Call[], parentId: number) =>
  out
    .filter((c) => c.method === "CALLBACK" && c.parentId === BigInt(parentId))
    .map((c) => {
      if (c.kind !== ERROR) return [Call_Kind[c.kind]];
      const e = RPCError.decode(c.argument);
      return [Call_Kind[c.kind], e.message, e.code];
    });

const cancels = (out: Call[]) =>
  out.filter((c) => c.method === "CANCEL").map((c) => [Number(c.parentId), Call_Kind[c.kind]]);

const errorOf = (s: { on(event: "error", listener: (err: Error) => void): unknown }) =>
  new Promise<unknown>((resolve) => s.on("error", resolve));

// a stream's items, and the error it ended with
const readAll = async <T>(s: AsyncIterable<T>) => {
  const items: T[] = [];
  try {
    for await (const v of s) items.push(v);
  } catch (e) {
    return { items, err: e as unknown };
  }
  return { items, err: undefined as unknown };
};

// resolves once cond() holds
const waitFor = async (cond: () => boolean, what: string, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(2);
  }
};

// get()'s value once it has stayed the same for ms
const steady = async (get: () => number, ms = 50) => {
  let v = get();
  let since = Date.now();
  const deadline = since + 5000;
  while (Date.now() - since < ms) {
    if (Date.now() > deadline) throw new Error(`never steady: ${v}`);
    await sleep(2);
    if (get() !== v) {
      v = get();
      since = Date.now();
    }
  }
  return v;
};

// Runs fn with mocha's uncaught exception handler off, returning the uncaught
// exceptions instead.
const uncaught = async (fn: () => Promise<void>): Promise<unknown[]> => {
  const caught: unknown[] = [];
  const listeners = process.listeners("uncaughtException");
  process.removeAllListeners("uncaughtException");
  process.on("uncaughtException", (e: unknown) => caught.push(e));
  try {
    await fn();
  } finally {
    process.removeAllListeners("uncaughtException");
    for (const l of listeners) process.on("uncaughtException", l);
  }
  return caught;
};

const blocked = (host: Host) => (host as unknown as { blocked: boolean }).blocked;

// A w that writes nothing: writableLength, unless hidden, is the bytes
// written plus extra.
const fakeW = (hidden = false) => {
  let written = 0;
  const f = {
    extra: 0,
    written: () => written,
    w: {
      write: (b: Uint8Array) => {
        written += b.byteLength;
        return true;
      },
      once: () => f.w,
    } as unknown as Writable,
  };
  if (!hidden) Object.defineProperty(f.w, "writableLength", { get: () => written + f.extra });
  return f;
};

// Fails each test of the calling suite that leaves an unhandled rejection.
const noUnhandledRejections = () => {
  let rejections: unknown[] = [];
  const onRejection = (e: unknown) => rejections.push(e);
  beforeEach(function () {
    rejections = [];
    process.on("unhandledRejection", onRejection);
  });
  afterEach(function () {
    process.off("unhandledRejection", onRejection);
    assert.deepStrictEqual(rejections.map(String), []);
  });
};

// A service whose handlers record their calls: "hold" returns a promise the
// test settles, "stream" a stream it writes, "sync" a response, "headers" the
// request's header count, and "endless" a stream of items made as fast as
// they are read.
const testService = (impl: StreamImpl) => {
  const calls: string[] = [];
  const holds: { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
  const streams: PassThrough[] = [];
  const seenHeaders: number[] = [];
  let produced = 0;
  const service = new ServiceRegistry();
  service.registerMethod(
    "hold",
    () => {
      calls.push("hold");
      return new Promise<RPCCallUnaryResponse>((resolve, reject) =>
        holds.push({ resolve, reject })
      );
    },
    RPCCallUnaryRequest
  );
  service.registerMethod(
    "stream",
    () => {
      calls.push("stream");
      const s = new impl.PassThrough({ objectMode: true });
      streams.push(s);
      return s;
    },
    RPCCallStreamRequest
  );
  service.registerMethod(
    "sync",
    () => {
      calls.push("sync");
      return new RPCCallUnaryResponse();
    },
    RPCCallUnaryRequest
  );
  service.registerMethod(
    "headers",
    (_: RPCCallUnaryRequest, call: Call) => {
      calls.push("headers");
      seenHeaders.push(call.headers.size);
      return new RPCCallUnaryResponse();
    },
    RPCCallUnaryRequest
  );
  service.registerMethod(
    "endless",
    () => {
      calls.push("endless");
      const s = new impl.Readable({
        objectMode: true,
        read: () => {
          setImmediate(() => s.push(new RPCCallStreamResponse({ id: BigInt(++produced) })));
        },
      });
      streams.push(s as PassThrough);
      return s;
    },
    RPCCallStreamRequest
  );
  return { service, calls, holds, streams, seenHeaders, produced: () => produced };
};

const unary = (host: Host) =>
  host.expectOne(host.call("m", new RPCCallUnaryRequest()), RPCCallUnaryResponse);
const testStream = (host: Host) => host.expectMany(host.call("s", new TestMessage()), TestMessage);
// a stream whose error, if it gets one, the test reads from destroyed
const quiet = <T extends { on(event: "error", listener: () => void): unknown }>(s: T): T => {
  s.on("error", () => undefined);
  return s;
};
const item = (id: number) => new TestMessage({ bytesValue: new Uint8Array([id]) });
const bytesOf = (items: unknown[]) => items.map((v) => Array.from((v as TestMessage).bytesValue));

for (const impl of impls) {
  describe(`Host limits, on ${impl.name}`, function () {
    noUnhandledRejections();

    describe("message size", function () {
      const testMax = (options: HostOptions, max: number) => {
        it(`takes a ${max}-byte frame, and closes on a longer prefix with ${JSON.stringify(options)}`, async function () {
          const { host, r, out, send, closes, callbacks } = connect(impl, { options });
          const ok = host.expectOne(host.call("m", new TestMessage()), TestMessage);
          send(sized(1, max));
          assert.strictEqual((await ok).bytesValue.byteLength > 0, true);

          const p = unary(host);
          const s = testStream(host);
          const errored = errorOf(s);
          await sleep(5);
          const written = out.length;
          // the prefix alone, without the frame
          r.write(
            new Writer()
              .uint32(max + 1)
              .finish()
              .slice()
          );
          await assert.rejects(p, new Error("rpc: message too large"));
          assert.deepStrictEqual(await errored, new Error("rpc: message too large"));
          assert.deepStrictEqual(closes, [new Error("rpc: message too large")]);
          assert.strictEqual(callbacks(), 0);
          await assert.rejects(unary(host), new Error("rpc: connection closed"));
          send(callback(1, DEFAULT, item(1)));
          await sleep(5);
          assert.strictEqual(out.length, written);
          assert.strictEqual(closes.length, 1);
        });
      };
      testMax({}, 512 * KiB);
      testMax({ maxMessageBytes: 0 }, 512 * KiB);
      testMax({ maxMessageBytes: NaN }, 512 * KiB);
      testMax({ maxMessageBytes: 300 }, 300);

      it("takes a frame of any size with a negative maxMessageBytes", async function () {
        const { host, send, closes } = connect(impl, { options: { maxMessageBytes: -1 } });
        const p = host.expectOne(host.call("m", new TestMessage()), TestMessage);
        send(sized(1, MiB));
        assert.strictEqual((await p).bytesValue.byteLength > 512 * KiB, true);
        assert.deepStrictEqual(closes, []);
      });

      it("closes on a malformed prefix", async function () {
        const { host, r, closes } = connect(impl);
        const p = unary(host);
        r.write(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x01]));
        await assert.rejects(p, new Error("rpc: malformed message length"));
        assert.deepStrictEqual(closes, [new Error("rpc: malformed message length")]);
      });

      it("keeps none of a chunk's other bytes alive in a queued item", async function () {
        const { host, sendRaw } = connect(impl);
        const s = testStream(host);
        sendRaw(frame(callback(1, DEFAULT, item(7))), frame(sized(99, 100 * KiB)));
        await sleep(5);
        const v = (await s[Symbol.asyncIterator]().next()).value as TestMessage;
        assert.deepStrictEqual(Array.from(v.bytesValue), [7]);
        assert.ok(v.bytesValue.buffer.byteLength < 100, `${v.bytesValue.buffer.byteLength}`);
        s.destroy();
      });

      it("keeps none of a chunk's other bytes alive in an item that ends the chunk", async function () {
        const { host, sendRaw } = connect(impl);
        const s = testStream(host);
        sendRaw(frame(sized(99, 100 * KiB)), frame(callback(1, DEFAULT, item(7))));
        await sleep(5);
        const v = (await s[Symbol.asyncIterator]().next()).value as TestMessage;
        assert.deepStrictEqual(Array.from(v.bytesValue), [7]);
        assert.ok(v.bytesValue.buffer.byteLength < 100, `${v.bytesValue.buffer.byteLength}`);
        s.destroy();
      });

      it("decodes bytes fields as plain Uint8Arrays, wherever frames fall in chunks", async function () {
        const { host, r, send, sendRaw } = connect(impl);
        const s = testStream(host);
        const f = (n: number) => frame(callback(1, DEFAULT, item(n)));
        sendRaw(f(1));
        sendRaw(f(2), f(3));
        const split = f(4);
        r.write(split.slice(0, 3));
        r.write(split.slice(3));
        sendRaw(frame(sized(1, 64 * KiB)));
        send(callback(1, Call_Kind.CALL_KIND_CLOSE));
        const { items } = await readAll<TestMessage>(s);
        assert.strictEqual(items.length, 5);
        assert.deepStrictEqual(
          items.map((v) => Object.getPrototypeOf(v.bytesValue) === Uint8Array.prototype),
          [true, true, true, true, true]
        );
      });

      it("puts a frame from small chunks together in a buffer that doubles up to its length", async function () {
        const { host, r } = connect(impl);
        const p = host.expectOne(host.call("m", new TestMessage()), TestMessage);
        const f = frame(sized(1, 100 * KiB));
        const partial = () =>
          (host as unknown as { partial?: Uint8Array }).partial?.byteLength ?? 0;
        const sizes: number[] = [];
        r.write(f.slice(0, 3));
        await new Promise((resolve) => setImmediate(resolve));
        sizes.push(partial());
        for (let i = 3; i < f.byteLength; i += 512) {
          r.write(f.slice(i, i + 512));
          await new Promise((resolve) => setImmediate(resolve));
          if (i + 512 < f.byteLength) {
            const size = partial();
            assert.ok(size > 0 && size <= Math.max(2 * (i + 512 - 3), 1024), `${size} at ${i}`);
            sizes.push(size);
          }
        }
        assert.ok(sizes[0] <= 1024, `${sizes[0]} after the prefix`);
        assert.strictEqual((await p).bytesValue.byteLength > 99 * KiB, true);
      });
    });

    describe("onClose", function () {
      it("is called once, without an error, when r ends", async function () {
        const { r, closes } = connect(impl);
        r.end();
        await sleep(5);
        r.destroy();
        await sleep(5);
        assert.deepStrictEqual(closes, [undefined]);
      });

      it("is called with r's error", async function () {
        const { host, r, closes } = connect(impl);
        const p = unary(host);
        r.on("error", () => undefined);
        r.destroy(new Error("reset"));
        await assert.rejects(p, new Error("rpc: connection closed"));
        await sleep(5);
        assert.deepStrictEqual(closes, [new Error("reset")]);
      });

      it("rethrows its throw from a timer", async function () {
        const r = new impl.PassThrough();
        const host = new impl.Host(new impl.PassThrough(), r, undefined, {
          onClose: () => {
            throw new Error("boom");
          },
        });
        const p = unary(host).catch((e: unknown) => e);
        let threw: unknown;
        const caught = await uncaught(async () => {
          try {
            r.write(
              new Writer()
                .uint32(600 * KiB)
                .finish()
                .slice()
            );
          } catch (e) {
            threw = e;
          }
          await sleep(10);
        });
        assert.strictEqual(threw, undefined);
        assert.deepStrictEqual(caught.map(String), ["Error: boom"]);
        assert.deepStrictEqual(await p, new Error("rpc: message too large"));
      });
    });

    describe("stream buffer", function () {
      // an item's charge: its frame, plus 256, plus 128 a header
      const cost = (c: ICall) =>
        body(c).byteLength + 256 + 128 * (c.headers as Map<string, Uint8Array>).size;
      const itemCall = (n: number, h = 0) => ({
        ...callback(1, DEFAULT, item(n)),
        headers: headers(h),
      });

      it("fails only the stream that would go over, discarding its backlog and cancelling it", async function () {
        const c = cost(itemCall(1));
        const { host, out, send, callbacks } = connect(impl, {
          options: { maxStreamBufferBytes: 3 * c },
        });
        const s = testStream(host);
        const other = host.expectMany(host.call("s", new TestMessage()), TestMessage);
        const p = unary(host);
        send(itemCall(1), itemCall(2), itemCall(3));
        await sleep(5);
        assert.deepStrictEqual(cancels(out), []);
        send(itemCall(4));
        const { items, err } = await readAll<TestMessage>(s);
        assert.deepStrictEqual(items, []);
        assert.ok(err instanceof RPCError);
        assert.deepStrictEqual([err.message, err.code], ["rpc: stream response buffer full", 1010]);
        await sleep(5);
        assert.deepStrictEqual(cancels(out), [[1, "CALL_KIND_CANCEL"]]);

        send({ ...callback(2, DEFAULT, item(5)) }, callback(2, Call_Kind.CALL_KIND_CLOSE));
        send(callback(3, DEFAULT, new RPCCallUnaryResponse()));
        assert.deepStrictEqual(bytesOf((await readAll<TestMessage>(other)).items), [[5]]);
        await p;
        assert.strictEqual(callbacks(), 0);
        assert.deepStrictEqual(cancels(out), [[1, "CALL_KIND_CANCEL"]]);
      });

      it("charges 128 a header", async function () {
        const c = cost(itemCall(1, 2));
        for (const [max, fails] of [
          [2 * c, false],
          [2 * c - 1, true],
        ] as const) {
          const { host, out, send } = connect(impl, { options: { maxStreamBufferBytes: max } });
          const s = quiet(testStream(host));
          send(itemCall(1, 2), itemCall(2, 2));
          await sleep(5);
          assert.strictEqual(s.destroyed, fails);
          assert.strictEqual(cancels(out).length, fails ? 1 : 0);
          s.destroy();
        }
      });

      it("takes an item over the limit when the backlog is empty", async function () {
        const { host, send } = connect(impl, { options: { maxStreamBufferBytes: 10 } });
        const s = testStream(host);
        send(itemCall(1), callback(1, Call_Kind.CALL_KIND_CLOSE));
        const { items, err } = await readAll<TestMessage>(s);
        assert.deepStrictEqual(bytesOf(items), [[1]]);
        assert.strictEqual(err, undefined);
      });

      it("frees an item's charge when it is read", async function () {
        const c = cost(itemCall(1));
        const { host, out, send } = connect(impl, { options: { maxStreamBufferBytes: 3 * c } });
        const s = testStream(host);
        const iter = s[Symbol.asyncIterator]();
        send(itemCall(1), itemCall(2), itemCall(3));
        await sleep(5);
        assert.deepStrictEqual(bytesOf([(await iter.next()).value]), [[1]]);
        send(itemCall(4), callback(1, Call_Kind.CALL_KIND_CLOSE));
        await sleep(5);
        assert.deepStrictEqual(cancels(out), []);
        const rest: unknown[] = [];
        for (let r = await iter.next(); !r.done; r = await iter.next()) rest.push(r.value);
        assert.deepStrictEqual(bytesOf(rest), [[2], [3], [4]]);
      });

      const testDefault = (options: HostOptions, max: number, itemBytes: number) => {
        it(`defaults to ${max / MiB} MiB with ${JSON.stringify(options)}`, async function () {
          const res = sized(1, itemBytes - 256);
          const n = max / itemBytes;
          const { host, out, send } = connect(impl, { options });
          const s = quiet(testStream(host));
          for (let i = 0; i < n; i++) send(res);
          await sleep(10);
          assert.strictEqual(s.destroyed, false);
          send(res);
          await sleep(10);
          assert.strictEqual(s.destroyed, true);
          assert.deepStrictEqual(cancels(out), [[1, "CALL_KIND_CANCEL"]]);
        });
      };
      testDefault({}, 16 * MiB, 512 * KiB);
      testDefault({ maxStreamBufferBytes: 0 }, 16 * MiB, 512 * KiB);
      testDefault({ maxStreamBufferBytes: NaN }, 16 * MiB, 512 * KiB);
      testDefault({ maxMessageBytes: 5 * MiB }, 20 * MiB, 5 * MiB);
      testDefault({ maxMessageBytes: -1 }, 16 * MiB, 512 * KiB);

      it("decodes queued responses only as they come first", async function () {
        let decoded = 0;
        const Counting = {
          decode: (b: Uint8Array) => {
            decoded++;
            return TestMessage.decode(b);
          },
        } as unknown as MessageClass<TestMessage>;
        const { host, send } = connect(impl);
        const s = host.expectMany(host.call("s", new TestMessage()), Counting);
        for (let i = 1; i <= 10; i++) send(itemCall(i));
        await sleep(5);
        assert.strictEqual(decoded, 1);
        const iter = s[Symbol.asyncIterator]();
        assert.deepStrictEqual(bytesOf([(await iter.next()).value]), [[1]]);
        assert.strictEqual(decoded, 2);
        s.destroy();
      });

      const bad = (): ICall => ({ ...callback(1, DEFAULT), argument: new Uint8Array([0x08]) });

      it("ends with a queued response's decode error, and cancels, once the ones before it are read", async function () {
        const { host, out, send } = connect(impl);
        const s = testStream(host);
        send(itemCall(1), itemCall(2), bad(), itemCall(4));
        await sleep(5);
        assert.strictEqual(s.destroyed, false);
        assert.deepStrictEqual(cancels(out), []);
        const { items, err } = await readAll<TestMessage>(s);
        assert.deepStrictEqual(bytesOf(items), [[1], [2]]);
        assert.match((err as Error).message, /index out of range/);
        await sleep(5);
        assert.deepStrictEqual(cancels(out), [[1, "CALL_KIND_CANCEL"]]);
      });

      it("ends with a queued response's decode error, without a cancel, after CLOSE", async function () {
        const { host, out, send } = connect(impl);
        const s = testStream(host);
        send(itemCall(1), bad(), callback(1, Call_Kind.CALL_KIND_CLOSE));
        const { items, err } = await readAll<TestMessage>(s);
        assert.deepStrictEqual(bytesOf(items), [[1]]);
        assert.match((err as Error).message, /index out of range/);
        await sleep(5);
        assert.deepStrictEqual(cancels(out), []);
      });

      it("is unbounded when negative", async function () {
        const { host, out, send } = connect(impl, { options: { maxStreamBufferBytes: -1 } });
        const s = testStream(host);
        const res = sized(1, 512 * KiB - 256);
        for (let i = 0; i < 40; i++) send(res);
        send(callback(1, Call_Kind.CALL_KIND_CLOSE));
        await sleep(10);
        const { items, err } = await readAll<TestMessage>(s);
        assert.strictEqual(items.length, 40);
        assert.strictEqual(err, undefined);
        assert.deepStrictEqual(cancels(out), []);
      });
    });

    describe("concurrent calls", function () {
      const tooMany = ["CALL_KIND_ERROR", "rpc: too many concurrent calls", 1003];

      it("refuses a request past the limit without calling its handler", async function () {
        const { service, calls } = testService(impl);
        const { out, send } = connect(impl, { service, options: { maxConcurrentCalls: 2 } });
        send(request(1, "hold"), request(2, "hold"), request(3, "hold"));
        await sleep(5);
        assert.deepStrictEqual(calls, ["hold", "hold"]);
        assert.deepStrictEqual(responses(out, 3), [tooMany]);
        assert.deepStrictEqual(responses(out, 1), []);
      });

      it("holds no slot for a handler that returns at once", async function () {
        const { service, calls } = testService(impl);
        const { out, send } = connect(impl, { service, options: { maxConcurrentCalls: 1 } });
        send(request(1, "sync"), request(2, "sync"), request(3, "sync"));
        await sleep(5);
        assert.deepStrictEqual(calls, ["sync", "sync", "sync"]);
        assert.deepStrictEqual(responses(out, 3), [["CALL_KIND_DEFAULT"]]);
      });

      const finishes: [
        string,
        string,
        (t: ReturnType<typeof testService>, c: ReturnType<typeof connect>) => void,
      ][] = [
        ["a reply", "hold", (t) => t.holds[0].resolve(new RPCCallUnaryResponse())],
        ["a rejection", "hold", (t) => t.holds[0].reject(new Error("no"))],
        ["CLOSE", "stream", (t) => t.streams[0].end()],
        ["a stream error", "stream", (t) => t.streams[0].destroy(new Error("no"))],
        ["an item that won't encode", "stream", (t) => t.streams[0].write({})],
        ["a CANCEL", "stream", (_, c) => c.send(cancel(1))],
        ["a CANCEL of a call whose handler hasn't settled", "hold", (_, c) => c.send(cancel(1))],
      ];
      for (const [how, method, finish] of finishes) {
        it(`frees the slot on ${how}`, async function () {
          const t = testService(impl);
          const c = connect(impl, { service: t.service, options: { maxConcurrentCalls: 1 } });
          c.send(request(1, method), request(2, "sync"));
          await sleep(5);
          assert.deepStrictEqual(responses(c.out, 2), [tooMany]);
          finish(t, c);
          await sleep(5);
          assert.strictEqual(c.serving(), 0);
          c.send(request(3, "sync"));
          await sleep(5);
          assert.deepStrictEqual(responses(c.out, 3), [["CALL_KIND_DEFAULT"]]);
          assert.deepStrictEqual(t.calls, [method, "sync"]);
        });
      }

      it("takes responses to its own calls while full", async function () {
        const { service } = testService(impl);
        const { host, out, send } = connect(impl, { service, options: { maxConcurrentCalls: 1 } });
        send(request(1, "hold"));
        await sleep(5);
        const p = unary(host);
        send(callback(1, DEFAULT, new RPCCallUnaryResponse({ id: BigInt(9) })));
        assert.strictEqual((await p).id, BigInt(9));
        assert.deepStrictEqual(responses(out, 1), []);
      });

      it("counts calls that reuse an id, and closing cancels them all", async function () {
        const t = testService(impl);
        const { r, out, send, serving } = connect(impl, {
          service: t.service,
          options: { maxConcurrentCalls: 2 },
        });
        send(request(1, "stream"), request(1, "stream"), request(2, "sync"));
        await sleep(5);
        assert.deepStrictEqual(t.calls, ["stream", "stream"]);
        assert.deepStrictEqual(responses(out, 2), [tooMany]);
        r.end();
        await sleep(5);
        assert.deepStrictEqual(
          t.streams.map((s) => s.destroyed),
          [true, true]
        );
        assert.strictEqual(serving(), 0);
      });

      const testDefault = (options: HostOptions, max: number) => {
        it(`serves ${max} calls with ${JSON.stringify(options)}`, async function () {
          const t = testService(impl);
          const { out, sendRaw } = connect(impl, { service: t.service, options });
          const reqs: Uint8Array[] = [];
          for (let i = 1; i <= max + 1; i++) reqs.push(frame(request(i, "hold")));
          sendRaw(...reqs);
          await sleep(10);
          assert.strictEqual(t.calls.length, max);
          assert.deepStrictEqual(responses(out, max), []);
          assert.deepStrictEqual(responses(out, max + 1), [tooMany]);
        });
      };
      testDefault({}, 128);
      testDefault({ maxConcurrentCalls: 0 }, 128);
      testDefault({ maxConcurrentCalls: NaN }, 128);

      it("has no limit when negative", async function () {
        const t = testService(impl);
        const { out, sendRaw } = connect(impl, {
          service: t.service,
          options: { maxConcurrentCalls: -1 },
        });
        const reqs: Uint8Array[] = [];
        for (let i = 1; i <= 1100; i++) reqs.push(frame(request(i, "hold")));
        sendRaw(...reqs);
        await sleep(10);
        assert.strictEqual(t.calls.length, 1100);
        assert.deepStrictEqual(out, []);
      });
    });

    describe("headers", function () {
      const tooMany = ["CALL_KIND_ERROR", "rpc: too many headers", 0];
      const withHeaders = (c: ICall, h: Map<string, Uint8Array>): ICall => ({ ...c, headers: h });

      const testLimit = (
        name: string,
        options: HostOptions,
        ok: () => Map<string, Uint8Array>,
        over: () => Map<string, Uint8Array>
      ) => {
        it(`takes ${name} on a request, and refuses one more, with ${JSON.stringify(options)}`, async function () {
          const t = testService(impl);
          const { out, send } = connect(impl, { service: t.service, options });
          send(
            withHeaders(request(1, "headers"), ok()),
            withHeaders(request(2, "headers"), over())
          );
          await sleep(5);
          assert.deepStrictEqual(t.seenHeaders, [ok().size]);
          assert.deepStrictEqual(responses(out, 1), [["CALL_KIND_DEFAULT"]]);
          assert.deepStrictEqual(responses(out, 2), [tooMany]);
        });

        it(`takes ${name} on a response, and fails a call on one more, with ${JSON.stringify(options)}`, async function () {
          const { host, out, send } = connect(impl, { options });
          const okCall = unary(host);
          send(withHeaders(callback(1, DEFAULT, new RPCCallUnaryResponse()), ok()));
          await okCall;
          const p = unary(host);
          send(withHeaders(callback(2, DEFAULT, new RPCCallUnaryResponse()), over()));
          await assert.rejects(p, new Error("rpc: too many headers"));

          const s = host.expectMany(
            host.call("s", new RPCCallStreamRequest()),
            RPCCallStreamResponse
          );
          send(withHeaders(callback(3, DEFAULT, new RPCCallStreamResponse()), ok()));
          send(withHeaders(callback(3, DEFAULT, new RPCCallStreamResponse()), over()));
          const { items, err } = await readAll(s);
          assert.strictEqual(items.length, 1);
          assert.deepStrictEqual(err, new Error("rpc: too many headers"));
          await sleep(5);
          assert.deepStrictEqual(cancels(out), [[3, "CALL_KIND_CANCEL"]]);
          assert.strictEqual(host["callbacks"].size, 0);
        });
      };
      testLimit(
        "64 headers",
        {},
        () => headers(64),
        () => headers(65)
      );
      testLimit(
        "64 headers",
        { maxHeaders: 0 },
        () => headers(64),
        () => headers(65)
      );
      testLimit(
        "2 headers",
        { maxHeaders: 2 },
        () => headers(2),
        () => headers(3)
      );
      testLimit(
        "64 KiB of headers",
        {},
        () => headerOfBytes(64 * KiB),
        () => headerOfBytes(64 * KiB + 1)
      );
      testLimit(
        "64 KiB of headers",
        { maxHeaderBytes: NaN },
        () => headerOfBytes(64 * KiB),
        () => headerOfBytes(64 * KiB + 1)
      );
      testLimit(
        "100 bytes of headers",
        { maxHeaderBytes: 100 },
        () => headerOfBytes(100),
        () => headerOfBytes(101)
      );

      it("counts repeated keys", async function () {
        const t = testService(impl);
        const { out, sendRaw } = connect(impl, { service: t.service, options: { maxHeaders: 2 } });
        const entry = new Writer()
          .uint32(10)
          .string("k")
          .uint32(18)
          .bytes(new Uint8Array())
          .finish();
        const b = new Writer().uint32(8).uint64(BigInt(1)).uint32(26).string("headers");
        for (let i = 0; i < 3; i++) b.uint32(50).bytes(entry);
        sendRaw(prefixed(b.finish().slice()));
        await sleep(5);
        assert.deepStrictEqual(t.calls, []);
        assert.deepStrictEqual(responses(out, 1), [tooMany]);
      });

      it("has no limits when negative", async function () {
        const t = testService(impl);
        const { out, send } = connect(impl, {
          service: t.service,
          options: { maxHeaders: -1, maxHeaderBytes: -1 },
        });
        const big = headers(1000);
        big.set("big", new Uint8Array(100 * KiB));
        send(withHeaders(request(1, "headers"), big));
        await sleep(5);
        assert.deepStrictEqual(t.seenHeaders, [1001]);
        assert.deepStrictEqual(responses(out, 1), [["CALL_KIND_DEFAULT"]]);
      });

      it("applies a CANCEL over the limits", async function () {
        const t = testService(impl);
        const { out, send, serving } = connect(impl, { service: t.service });
        send(request(1, "stream"));
        await sleep(5);
        send(withHeaders(cancel(1), headers(65)));
        await sleep(5);
        assert.strictEqual(t.streams[0].destroyed, true);
        assert.strictEqual(serving(), 0);
        assert.deepStrictEqual(responses(out, 1), []);
      });

      it("rejects 80k headers without decoding the frame", async function () {
        const t = testService(impl);
        const { out, sendRaw } = connect(impl, { service: t.service });
        const b = new Writer().uint32(8).uint64(BigInt(1)).uint32(26).string("headers");
        for (let i = 0; i < 80000; i++) {
          b.uint32(50)
            .fork()
            .uint32(10)
            .bytes(new Uint8Array([i & 127]))
            .ldelim();
        }
        const big = b.finish().slice();
        const decode = Call.decode.bind(Call) as typeof Call.decode;
        let decoded = 0;
        Call.decode = (r: Reader | Uint8Array, length?: number) => {
          if (r instanceof Uint8Array && r.byteLength === big.byteLength) decoded++;
          return decode(r, length);
        };
        try {
          sendRaw(prefixed(big));
          await sleep(10);
        } finally {
          Call.decode = decode;
        }
        assert.strictEqual(decoded, 0);
        assert.deepStrictEqual(t.calls, []);
        assert.deepStrictEqual(responses(out, 1), [tooMany]);
      });

      it("reads an over-limit frame's last id and method, as decoding does", async function () {
        const t = testService(impl);
        const { out, sendRaw, send } = connect(impl, { service: t.service });
        send(request(1, "stream"));
        await sleep(5);
        const over = (w: Writer) => {
          for (let i = 0; i < 65; i++) w.uint32(50).fork().uint32(10).string(`h${i}`).ldelim();
          return prefixed(w.finish().slice());
        };
        // ids 2 then 3, methods CANCEL then sync: a request 3
        sendRaw(
          over(
            new Writer()
              .uint32(8)
              .uint64(BigInt(2))
              .uint32(8)
              .uint64(BigInt(3))
              .uint32(16)
              .uint64(BigInt(1))
              .uint32(26)
              .string("CANCEL")
              .uint32(26)
              .string("sync")
          )
        );
        await sleep(5);
        assert.deepStrictEqual(responses(out, 3), [tooMany]);
        assert.deepStrictEqual(responses(out, 2), []);
        assert.strictEqual(t.streams[0].destroyed, false);
        // methods sync then CANCEL: a cancel of 1
        sendRaw(
          over(
            new Writer()
              .uint32(8)
              .uint64(BigInt(4))
              .uint32(16)
              .uint64(BigInt(1))
              .uint32(26)
              .string("sync")
              .uint32(26)
              .string("CANCEL")
          )
        );
        await sleep(5);
        assert.strictEqual(t.streams[0].destroyed, true);
        assert.deepStrictEqual(responses(out, 4), []);
      });

      // a request "headers" whose header entry's key is a varint, so that a
      // decoder reading it as a length skips into the Call's next field and
      // takes 100 entries hidden in it as the Call's own
      const entryHide = (): Uint8Array => {
        const hidden = new Writer();
        for (let i = 0; i < 100; i++) hidden.uint32(50).fork().uint32(10).string(`h${i}`).ldelim();
        const hiddenBytes = hidden.finish().slice();
        const argHeader = new Writer().uint32(42).uint32(hiddenBytes.length).finish().slice();
        const entry = new Writer().uint32(8).uint32(argHeader.length).finish().slice();
        const head = new Writer()
          .uint32(8)
          .uint64(BigInt(1))
          .uint32(26)
          .string("headers")
          .uint32(50)
          .bytes(entry)
          .finish()
          .slice();
        return join([head, argHeader, hiddenBytes]);
      };

      // a request "headers" with a header entry whose key is a varint 2
      // followed by a field 2 of 0, which Call.decode takes as a 2-byte key
      const entryKeyVarint = (): Uint8Array =>
        new Writer()
          .uint32(8)
          .uint64(BigInt(1))
          .uint32(26)
          .string("headers")
          .uint32(50)
          .bytes(new Uint8Array([8, 2, 16, 0]))
          .finish()
          .slice();

      // a request "headers" whose envelope is malformed so as to hide 100
      // header entries from a scan that skips fields by their wire type
      const hidden = (): Uint8Array => {
        const entries = new Writer();
        for (let i = 0; i < 100; i++) entries.uint32(50).fork().uint32(10).string(`h${i}`).ldelim();
        // id as a length-delimited field: a decoder that reads it as a varint
        // takes the entries as the Call's own fields
        return new Writer()
          .uint32(26)
          .string("headers")
          .uint32(10)
          .bytes(entries.finish().slice())
          .finish()
          .slice();
      };

      // a request "headers" with a header entry whose key runs past its end,
      // into bytes that also read as a Call field (kind 0)
      const overrun = (): Uint8Array =>
        new Writer()
          .uint32(8)
          .uint64(BigInt(1))
          .uint32(26)
          .string("headers")
          .uint32(50)
          .bytes(new Uint8Array([10, 2]))
          .uint32(32)
          .uint32(0)
          .finish()
          .slice();

      // field 6 as a varint
      const wrongType = (): Uint8Array =>
        new Writer()
          .uint32(8)
          .uint64(BigInt(1))
          .uint32(26)
          .string("headers")
          .uint32(48)
          .uint32(0)
          .finish()
          .slice();

      for (const [name, b] of [
        ["one whose header entry runs past its length", overrun],
        ["one with a field of the wrong wire type", wrongType],
        ["one that hides headers in a field of the wrong wire type", hidden],
        ["one whose header entry's key isn't length-delimited", entryHide],
        [
          "one whose header entry's key is a varint that Call.decode reads as a length",
          entryKeyVarint,
        ],
      ] as const) {
        it(`drops a malformed frame: ${name}`, async function () {
          const t = testService(impl);
          const { out, sendRaw, send } = connect(impl, { service: t.service });
          sendRaw(prefixed(b()));
          send(request(5, "sync"));
          await sleep(5);
          assert.deepStrictEqual(t.calls, ["sync"]);
          assert.deepStrictEqual(
            out.map((c) => Number(c.parentId)),
            [5]
          );
        });
      }
    });

    describe("backpressure", function () {
      it("pauses served streams until w drains", async function () {
        const t = testService(impl);
        const c = connect(impl, { service: t.service, hwm: 64, reading: false });
        c.send(request(1, "endless"));
        await waitFor(() => blocked(c.host), "w to fill");
        const paused = await steady(t.produced);
        assert.ok(paused < 100, `${paused}`);
        c.read();
        await waitFor(() => t.produced() > paused + 100, "the stream to resume");
        c.send(cancel(1));
        await waitFor(() => t.streams[0].destroyed, "the stream to be destroyed");
      });

      it("pauses a stream served while w is full", async function () {
        const t = testService(impl);
        const c = connect(impl, { service: t.service, hwm: 64, reading: false });
        c.send(request(1, "endless"));
        await waitFor(() => blocked(c.host), "w to fill");
        c.send(request(2, "endless"));
        await waitFor(() => t.calls.length === 2, "the second stream");
        const paused = await steady(t.produced);
        assert.ok(paused < 100, `${paused}`);
        c.read();
        await waitFor(() => responses(c.out, 2).length > 50, "the second stream's items");
        c.send(cancel(1), cancel(2));
      });

      it("sends unary replies while w is full, and drops refusals", async function () {
        const t = testService(impl);
        const c = connect(impl, {
          service: t.service,
          hwm: 64,
          reading: false,
          options: { maxConcurrentCalls: 2 },
        });
        c.send(request(1, "endless"));
        await waitFor(() => blocked(c.host), "w to fill");
        let backlog = await steady(c.backlog);
        c.send(request(2, "sync"));
        await waitFor(() => c.backlog() > backlog, "the reply to 2");
        backlog = c.backlog();
        c.send(
          request(3, "hold"),
          request(4, "sync"),
          withHeaders65(request(5, "sync")),
          request(6, "nope"),
          { ...request(7, "sync"), argument: new Uint8Array([0x08]) }
        );
        await waitFor(() => t.calls.includes("hold"), "the call to hold");
        await sleep(5);
        assert.strictEqual(c.backlog(), backlog);
        c.send(cancel(1));
        c.read();
        await waitFor(() => responses(c.out, 2).length > 0, "the reply to 2");
        await waitFor(() => !blocked(c.host), "w to drain");
        for (const id of [4, 5, 6, 7]) assert.deepStrictEqual(responses(c.out, id), []);
        // refusals are sent once w has drained
        c.send(request(8, "hold"), request(9, "sync"), request(10, "nope"));
        await waitFor(() => responses(c.out, 10).length > 0, "the reply to 10");
        assert.deepStrictEqual(responses(c.out, 9), [
          ["CALL_KIND_ERROR", "rpc: too many concurrent calls", 1003],
        ]);
        assert.deepStrictEqual(t.calls, ["endless", "sync", "hold", "hold"]);
      });

      it("drops not-implemented and undecodable-request errors while w is full", async function () {
        const t = testService(impl);
        const c = connect(impl, { service: t.service, hwm: 64, reading: false });
        c.send(request(1, "endless"));
        await waitFor(() => blocked(c.host), "w to fill");
        const backlog = await steady(c.backlog);
        c.send(request(2, "nope"), { ...request(3, "sync"), argument: new Uint8Array([0x08]) });
        c.send(request(4, "hold"));
        await waitFor(() => t.calls.includes("hold"), "the call to hold");
        await sleep(5);
        assert.strictEqual(c.backlog(), backlog);
        c.send(cancel(1));
        c.read();
        await waitFor(() => !blocked(c.host), "w to drain");
        c.send(request(5, "nope"), { ...request(6, "sync"), argument: new Uint8Array([0x08]) });
        await waitFor(() => responses(c.out, 6).length > 0, "the reply to 6");
        assert.deepStrictEqual(responses(c.out, 2), []);
        assert.deepStrictEqual(responses(c.out, 3), []);
        assert.deepStrictEqual(responses(c.out, 5), [
          ["CALL_KIND_ERROR", "method not implemented: nope", 0],
        ]);
        assert.deepStrictEqual(responses(c.out, 6)[0][0], "CALL_KIND_ERROR");
      });

      it("keeps streams paused while w never drains, until the host closes", async function () {
        const t = testService(impl);
        const w = new impl.Writable({ highWaterMark: 1, write: () => undefined });
        const r = new impl.PassThrough();
        const closes: unknown[] = [];
        const host = new impl.Host(w, r, t.service, { onClose: (err) => closes.push(err) });
        r.write(frame(request(1, "endless")));
        await waitFor(() => blocked(host), "w to fill");
        const paused = await steady(t.produced);
        assert.ok(paused < 100, `${paused}`);
        r.end();
        await waitFor(() => t.streams[0].destroyed, "the stream to be destroyed");
        assert.strictEqual((host as unknown as { serving: Set<unknown> }).serving.size, 0);
        assert.deepStrictEqual(closes, [undefined]);
      });

      it("doesn't pause for a w without once()", async function () {
        const t = testService(impl);
        let writes = 0;
        const w = {
          write: () => {
            writes++;
            return false;
          },
        } as unknown as Writable;
        const r = new impl.PassThrough();
        new impl.Host(w, r, t.service);
        r.write(frame(request(1, "endless")));
        await waitFor(() => writes > 100, "100 writes");
        r.end();
      });
    });

    describe("write buffer", function () {
      // a reply's frame, as the host's n-th call
      const replyBytes = frame({
        id: BigInt(1),
        parentId: BigInt(1),
        method: "CALLBACK",
      }).byteLength;

      it("closes the host when w holds more than maxWriteBufferBytes", async function () {
        const t = testService(impl);
        const f = fakeW();
        const r = new impl.PassThrough();
        const closes: unknown[] = [];
        const host = new impl.Host(f.w, r, t.service, {
          maxWriteBufferBytes: 1000,
          onClose: (err) => closes.push(err),
        });
        const p = unary(host).catch((e: unknown) => e);
        f.extra = 1000 - f.written() - 2 * replyBytes;
        r.write(frame(request(1, "sync")));
        r.write(frame(request(2, "sync")));
        await sleep(5);
        assert.deepStrictEqual(closes, []);
        r.write(frame(request(3, "sync")));
        await sleep(5);
        assert.deepStrictEqual(closes, [new Error("rpc: peer not reading")]);
        assert.deepStrictEqual(await p, new Error("rpc: peer not reading"));
        const written = f.written();
        r.write(frame(request(4, "sync")));
        await sleep(5);
        assert.strictEqual(f.written(), written);
      });

      it("closes the host when a w that's never read fills", async function () {
        const t = testService(impl);
        const w = new impl.PassThrough({ highWaterMark: KiB });
        const r = new impl.PassThrough();
        const closes: unknown[] = [];
        new impl.Host(w, r, t.service, {
          maxWriteBufferBytes: 4 * KiB,
          onClose: (err) => closes.push(err),
        });
        const reqs: Uint8Array[] = [];
        for (let i = 1; i <= 2000; i++) reqs.push(frame(request(i, "sync")));
        r.write(join(reqs));
        await waitFor(() => closes.length > 0, "the host to close");
        assert.deepStrictEqual(closes, [new Error("rpc: peer not reading")]);
        assert.ok(w.writableLength <= 4 * KiB + replyBytes, `${w.writableLength}`);
      });

      const testDefault = (options: HostOptions, max: number) => {
        it(`defaults to ${max / MiB} MiB with ${JSON.stringify(options)}`, async function () {
          const t = testService(impl);
          const f = fakeW();
          const r = new impl.PassThrough();
          const closes: unknown[] = [];
          new impl.Host(f.w, r, t.service, { ...options, onClose: (err) => closes.push(err) });
          f.extra = max - f.written() - replyBytes;
          r.write(frame(request(1, "sync")));
          await sleep(5);
          assert.deepStrictEqual(closes, []);
          r.write(frame(request(2, "sync")));
          await sleep(5);
          assert.deepStrictEqual(closes, [new Error("rpc: peer not reading")]);
        });
      };
      testDefault({}, 16 * MiB);
      testDefault({ maxWriteBufferBytes: 0 }, 16 * MiB);
      testDefault({ maxWriteBufferBytes: NaN }, 16 * MiB);
      testDefault({ maxMessageBytes: 5 * MiB }, 20 * MiB);
      testDefault({ maxMessageBytes: -1 }, 16 * MiB);

      for (const [name, options, hidden] of [
        ["when negative", { maxWriteBufferBytes: -1 }, false],
        ["for a w without writableLength", {}, true],
      ] as const) {
        it(`has no limit ${name}`, async function () {
          const t = testService(impl);
          const f = fakeW(hidden);
          const r = new impl.PassThrough();
          const closes: unknown[] = [];
          new impl.Host(f.w, r, t.service, { ...options, onClose: (err) => closes.push(err) });
          f.extra = 1024 * MiB;
          r.write(frame(request(1, "sync")));
          await sleep(5);
          assert.deepStrictEqual(closes, []);
          assert.ok(f.written() > 0);
        });
      }
    });

    describe("dispatch", function () {
      // a service whose "tick" records, for each call, the synchronous run of
      // the event loop it came in
      const tickService = () => {
        const runs: number[] = [];
        const log: string[] = [];
        let run = 0;
        let armed = false;
        const service = new ServiceRegistry();
        service.registerMethod(
          "tick",
          (req: RPCCallUnaryRequest) => {
            if (!armed) {
              armed = true;
              queueMicrotask(() => {
                armed = false;
                run++;
              });
            }
            runs.push(run);
            log.push(String(req.id));
            return new RPCCallUnaryResponse({ id: req.id });
          },
          RPCCallUnaryRequest
        );
        // the number of calls in each run
        const perRun = () => {
          const counts = new Map<number, number>();
          for (const r of runs) counts.set(r, (counts.get(r) ?? 0) + 1);
          return Array.from(counts.values());
        };
        return { service, log, perRun };
      };

      // requests to "tick", ids from to to-1+n, each padded to about pad bytes
      const ticks = (from: number, n: number, pad = 0) => {
        const frames: Uint8Array[] = [];
        for (let i = from; i < from + n; i++) {
          const arg = new Writer().uint32(8).uint64(BigInt(i));
          if (pad) arg.uint32((15 << 3) | 2).bytes(new Uint8Array(pad));
          frames.push(frame({ id: BigInt(i), method: "tick", argument: arg.finish().slice() }));
        }
        return join(frames);
      };

      it("dispatches 1024 frames a turn, in order, the rest from a timer", async function () {
        const t = tickService();
        const { r, out } = connect(impl, { service: t.service });
        r.write(ticks(1, 5000));
        await waitFor(() => t.log.length === 5000, "5000 calls");
        const perRun = t.perRun();
        assert.strictEqual(perRun[0], 1024);
        assert.ok(
          perRun.every((n) => n <= 1024),
          `${perRun.join(",")}`
        );
        assert.deepStrictEqual(
          t.log,
          Array.from({ length: 5000 }, (_, i) => String(i + 1))
        );
        await waitFor(() => out.length === 5000, "5000 replies");
        assert.deepStrictEqual(
          out.map((c) => Number(c.parentId)),
          Array.from({ length: 5000 }, (_, i) => i + 1)
        );
      });

      it("takes data that comes while frames wait for the timer after them", async function () {
        const t = tickService();
        const { r } = connect(impl, { service: t.service });
        r.write(ticks(1, 3000));
        r.write(ticks(3001, 1000));
        await waitFor(() => t.log.length === 4000, "4000 calls");
        assert.strictEqual(t.perRun()[0], 1024);
        assert.deepStrictEqual(
          t.log,
          Array.from({ length: 4000 }, (_, i) => String(i + 1))
        );
      });

      it("dispatches at once while more than 1 MiB waits", async function () {
        const t = tickService();
        const { r } = connect(impl, { service: t.service });
        const chunk = ticks(1, 10000, 200);
        assert.ok(chunk.byteLength > 2 * MiB);
        r.write(chunk);
        await waitFor(() => t.log.length === 10000, "10000 calls");
        const perRun = t.perRun();
        assert.ok(perRun[0] > 1024, `${perRun.join(",")}`);
      });

      it("dispatches the frames read before closing", async function () {
        const t = tickService();
        const { host, r, closes } = connect(impl, { service: t.service });
        const p = unary(host);
        r.write(join([ticks(1, 3000), frame(callback(1, DEFAULT, new RPCCallUnaryResponse()))]));
        r.end();
        await p;
        assert.strictEqual(t.log.length, 3000);
        await waitFor(() => closes.length > 0, "the host to close");
        assert.deepStrictEqual(closes, [undefined]);
      });

      it("answers nothing to empty frames, or to requests with id 0", async function () {
        const { out, r, send } = connect(impl, { options: { maxMalformedFrames: -1 } });
        r.write(new Uint8Array(64 * KiB));
        send({ method: "nope", argument: encodeArg(new RPCCallUnaryRequest()) });
        send(request(7, "nope"));
        await waitFor(() => responses(out, 7).length > 0, "the reply to 7");
        assert.deepStrictEqual(
          out.map((c) => Number(c.parentId)),
          [7]
        );
      });

      it("takes responses and cancels with id 0", async function () {
        const t = testService(impl);
        const { host, send } = connect(impl, { service: t.service });
        const p = unary(host);
        send({
          ...callback(1, DEFAULT, new RPCCallUnaryResponse({ id: BigInt(5) })),
          id: BigInt(0),
        });
        assert.strictEqual((await p).id, BigInt(5));
        send(request(1, "stream"));
        await waitFor(() => t.streams.length === 1, "the stream");
        send({ ...cancel(1), id: BigInt(0) });
        await waitFor(() => t.streams[0].destroyed, "the stream to be destroyed");
      });
    });

    describe("scan and decode", function () {
      const decodes = (b: Uint8Array) => {
        try {
          Call.decode(b);
          return true;
        } catch {
          return false;
        }
      };

      // groups of field 7 nested n deep, ending with an end-group tag for
      // field end
      const groups =
        (n: number, end = 7) =>
        (w: Writer) => {
          for (let i = 0; i < n; i++) w.uint32((7 << 3) | 3);
          for (let i = 0; i < n; i++) w.uint32(((i === n - 1 ? end : 7) << 3) | 4);
          return w;
        };
      // the same inside a header entry
      const entryGroups =
        (n: number, end = 7) =>
        (w: Writer) =>
          w.uint32(50).bytes(groups(n, end)(new Writer().uint32(10).string("g")).finish().slice());
      // a header entry whose key runs past the entry, into a Call field
      const overrunEntry = (w: Writer) =>
        w
          .uint32(50)
          .bytes(new Uint8Array([10, 2]))
          .uint32(32)
          .uint32(0);

      // a Call with id, parentId, method and n headers, then extra
      const body = (
        id: number,
        parentId: number,
        method: string,
        n: number,
        extra: (w: Writer) => Writer
      ) => {
        const w = new Writer().uint32(8).uint64(BigInt(id));
        if (parentId) w.uint32(16).uint64(BigInt(parentId));
        w.uint32(26).string(method);
        for (let i = 0; i < n; i++) w.uint32(50).fork().uint32(10).string(`h${i}`).ldelim();
        return extra(w).finish().slice();
      };

      const cases: [string, (w: Writer) => Writer][] = [
        ["a mismatched end-group tag", groups(1, 9)],
        ["a mismatched end-group tag in a header entry", entryGroups(1, 9)],
        ["99 nested groups", groups(99)],
        ["100 nested groups", groups(100)],
        ["101 nested groups", groups(101)],
        ["98 nested groups in a header entry", entryGroups(98)],
        ["99 nested groups in a header entry", entryGroups(99)],
        ["a header entry that runs past its length", overrunEntry],
      ];
      for (const [name, extra] of cases) {
        it(`serves, refuses or drops a frame with ${name} as Call.decode takes it`, async function () {
          const t = testService(impl);
          const { out, sendRaw, send } = connect(impl, { service: t.service });
          send(request(1, "stream"));
          await waitFor(() => t.streams.length === 1, "the stream");
          const within = body(5, 0, "sync", 0, extra);
          const overRequest = body(6, 0, "sync", 65, extra);
          const overCancel = body(7, 1, "CANCEL", 65, extra);
          sendRaw(prefixed(within));
          sendRaw(prefixed(overRequest));
          sendRaw(prefixed(overCancel));
          send(request(8, "sync"));
          await waitFor(() => responses(out, 8).length > 0, "the reply to 8");
          const ok = decodes(within);
          assert.strictEqual(decodes(overRequest), ok);
          assert.strictEqual(decodes(overCancel), ok);
          assert.deepStrictEqual(responses(out, 5), ok ? [["CALL_KIND_DEFAULT"]] : []);
          assert.deepStrictEqual(responses(out, 6), ok ? [tooManyHeaders] : []);
          assert.strictEqual(t.streams[0].destroyed, ok);
        });
      }
    });

    describe("malformed frames", function () {
      const bad: [string, () => Uint8Array][] = [
        ["an empty frame", () => prefixed(new Uint8Array())],
        ["a truncated tag", () => prefixed(new Uint8Array([0x80]))],
        ["a request with id 0", () => frame({ method: "sync" })],
        ["a field of the wrong wire type", () => prefixed(new Uint8Array([0x0a, 0x00]))],
        [
          "a request whose argument doesn't decode",
          () => frame({ ...request(9, "sync"), argument: new Uint8Array([0x08]) }),
        ],
      ];

      for (const [name, make] of bad) {
        it(`closes the host at maxMalformedFrames, counting ${name}`, async function () {
          const t = testService(impl);
          const { host, out, sendRaw, send, closes } = connect(impl, {
            service: t.service,
            options: { maxMalformedFrames: 3 },
          });
          const p = unary(host).catch((e: unknown) => e);
          sendRaw(make(), make());
          send(request(5, "sync"));
          await waitFor(() => responses(out, 5).length > 0, "the reply to 5");
          assert.deepStrictEqual(closes, []);
          sendRaw(make());
          await waitFor(() => closes.length > 0, "the host to close");
          assert.deepStrictEqual(closes, [new Error("rpc: too many malformed frames")]);
          assert.deepStrictEqual(await p, new Error("rpc: too many malformed frames"));
          send(request(6, "sync"));
          await sleep(5);
          assert.deepStrictEqual(responses(out, 6), []);
        });
      }

      const testDefault = (options: HostOptions, max: number) => {
        it(`closes the host at ${max} malformed frames with ${JSON.stringify(options)}`, async function () {
          const { sendRaw, closes } = connect(impl, { options });
          const empty = prefixed(new Uint8Array());
          sendRaw(...Array.from({ length: max - 1 }, () => empty));
          await sleep(5);
          assert.deepStrictEqual(closes, []);
          sendRaw(empty);
          await waitFor(() => closes.length > 0, "the host to close");
          assert.deepStrictEqual(closes, [new Error("rpc: too many malformed frames")]);
        });
      };
      testDefault({}, 64);
      testDefault({ maxMalformedFrames: 0 }, 64);
      testDefault({ maxMalformedFrames: NaN }, 64);

      it("has no limit when negative", async function () {
        const { out, r, send, closes } = connect(impl, { options: { maxMalformedFrames: -1 } });
        r.write(new Uint8Array(10000));
        send(request(5, "nope"));
        await waitFor(() => responses(out, 5).length > 0, "the reply to 5");
        assert.deepStrictEqual(closes, []);
      });

      it("doesn't count frames over a header limit, or responses to unknown calls", async function () {
        const t = testService(impl);
        const { out, send, closes } = connect(impl, {
          service: t.service,
          options: { maxMalformedFrames: 2 },
        });
        for (let i = 0; i < 10; i++) {
          send(withHeaders65(request(10 + i, "sync")));
          send(callback(500 + i, DEFAULT, new RPCCallUnaryResponse()));
        }
        send(request(5, "sync"));
        await waitFor(() => responses(out, 5).length > 0, "the reply to 5");
        assert.deepStrictEqual(closes, []);
        assert.deepStrictEqual(responses(out, 10), [tooManyHeaders]);
      });
    });
  });
}
