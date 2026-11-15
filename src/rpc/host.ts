import { Readable, Writable } from "stream";

import {
  Call,
  Call_Kind,
  Cancel,
  Close,
  Error as RPCError,
  Undefined,
} from "../apis/strims/rpc/rpc";
import { Message, MessageClass } from "../pb/message";
import Reader from "../pb/reader";
import Writer from "../pb/writer";
import ServiceRegistry from "./service";
import { Readable as GenericReadable } from "./stream";

const CALL_TIMEOUT_MS = 5000;
// setTimeout's longest delay; it fires a longer one at once
const MAX_TIMEOUT_MS = 0x7fffffff;

// a response to the call its parentId names
const CALLBACK_METHOD = "CALLBACK";
// a request to stop serving the call its parentId names
const CANCEL_METHOD = "CANCEL";

// The rpc.Error a call answers with when its handler throws or rejects
// with e.
const toCallError = (e: unknown): RPCError => {
  const { message, code } = (e ?? {}) as { message?: string; code?: number };
  return new RPCError({
    message: String(message),
    code: Number(code) >>> 0,
  });
};

// A response's rpc.Error, or the error decoding it.
const decodeCallError = (b: Uint8Array): unknown => {
  try {
    return RPCError.decode(b);
  } catch (e) {
    return e;
  }
};

const DEFAULT_MAX_MESSAGE_BYTES = 512 * 1024;
const MIN_DEFAULT_STREAM_BUFFER_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT_CALLS = 128;
const DEFAULT_MAX_HEADERS = 64;
const DEFAULT_MAX_HEADER_BYTES = 64 * 1024;
// what a queued stream response is charged beyond its frame
const RESPONSE_OVERHEAD = 256;
const HEADER_OVERHEAD = 128;

// strims.rpc.errors.ErrorCode values
const TOO_MANY_CONCURRENT_CALLS = 1003;
const OVERFLOW = 1010;

const connectionClosed = (): Error => new Error("rpc: connection closed");
const messageTooLarge = (): Error => new Error("rpc: message too large");
const malformedLength = (): Error => new Error("rpc: malformed message length");
const tooManyHeaders = (): Error => new Error("rpc: too many headers");
const streamBufferFull = (): unknown =>
  new RPCError({ message: "rpc: stream response buffer full", code: OVERFLOW });

// The error for a response of a kind the call can't take.
const unexpectedKind = (kind: Call_Kind): Error =>
  new Error(`rpc: unexpected response kind ${Call_Kind[kind] ?? kind}`);

// Whether stream has emitted end; readable-stream 3 has no readableEnded.
const hasEnded = (stream: Readable): boolean => {
  const s = stream as unknown as {
    readableEnded?: boolean;
    _readableState?: { endEmitted?: boolean };
  };
  return s.readableEnded ?? s._readableState?.endEmitted === true;
};

// A data chunk's bytes, without copying.
const toBytes = (data: ArrayBufferView | ArrayBuffer): Uint8Array => {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data);
};

const concat = (chunks: Uint8Array[], len: number): Uint8Array => {
  const buf = new Uint8Array(len);
  let pos = 0;
  for (const chunk of chunks) {
    buf.set(chunk, pos);
    pos += chunk.byteLength;
  }
  return buf;
};

// An option's limit: def for 0, NaN or undefined, and none (Infinity) if negative.
const limit = (v: number | undefined, def: number): number => (!v ? def : v < 0 ? Infinity : v);

// The wire type of each of a Call's fields, by field number.
const CALL_WIRE_TYPES = [-1, 0, 0, 2, 0, 2, 2];
const LEN = 2;

// A Call's fields read without decoding it.
interface Envelope {
  id: bigint;
  parentId: bigint;
  // the offset of the method's length, or -1
  methodPos: number;
  headers: number;
  // the sum of the header entries' lengths
  headerBytes: number;
}

const malformedCall = (): Error => new Error("rpc: malformed call");

// Reads frame's envelope. It throws unless frame is a Call whose known fields
// have their wire types and whose header entries' fields end at the entries'
// lengths.
const scanCall = (frame: Uint8Array): Envelope => {
  const env: Envelope = {
    id: BigInt(0),
    parentId: BigInt(0),
    methodPos: -1,
    headers: 0,
    headerBytes: 0,
  };
  const r = new Reader(frame);
  while (r.pos < r.len) {
    const tag = r.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;
    if (field > 0 && field < CALL_WIRE_TYPES.length && wireType !== CALL_WIRE_TYPES[field]) {
      throw malformedCall();
    }
    switch (field) {
      case 1:
        env.id = r.uint64();
        break;
      case 2:
        env.parentId = r.uint64();
        break;
      case 3:
        env.methodPos = r.pos;
        r.skipType(wireType);
        break;
      case 6: {
        const len = r.uint32();
        const end = r.pos + len;
        while (r.pos < end) {
          const entryTag = r.uint32();
          const entryField = entryTag >>> 3;
          if ((entryField === 1 || entryField === 2) && (entryTag & 7) !== LEN) {
            throw malformedCall();
          }
          r.skipType(entryTag & 7);
        }
        if (r.pos !== end) {
          throw malformedCall();
        }
        env.headers++;
        env.headerBytes += len;
        break;
      }
      default:
        r.skipType(wireType);
    }
  }
  return env;
};

// The method of the Call env was read from.
const methodOf = (frame: Uint8Array, env: Envelope): string => {
  if (env.methodPos < 0) {
    return "";
  }
  const r = new Reader(frame);
  r.pos = env.methodPos;
  return r.string();
};

/**
 * A Host's limits. For each number, 0, NaN or omitted means the default, and a
 * negative value means no limit.
 */
export interface HostOptions {
  /**
   * The longest frame read, in bytes, not counting its length prefix; default
   * 512 KiB. A longer one closes the host with Error("rpc: message too large").
   */
  maxMessageBytes?: number;
  /**
   * The bytes of responses an expectMany stream holds unread, each counted as
   * its frame plus 256, plus 128 per header; default the larger of 16 MiB and
   * 4 × maxMessageBytes. A response that would take a non-empty backlog over
   * it discards the backlog, cancels the call and ends the stream with an
   * rpc.Error "rpc: stream response buffer full", code 1010.
   */
  maxStreamBufferBytes?: number;
  /**
   * The calls served at once, each from its request until its last response
   * is sent or it is cancelled; default 128. More are answered with an
   * rpc.Error "rpc: too many concurrent calls", code 1003.
   */
  maxConcurrentCalls?: number;
  /** The header entries in a frame, repeated keys included; default 64. */
  maxHeaders?: number;
  /**
   * The bytes of a frame's header entries, not counting each entry's tag and
   * length; default 64 KiB. A frame over either header limit isn't decoded:
   * a request is answered with an rpc.Error "rpc: too many headers", a
   * response fails its call with Error("rpc: too many headers"), cancelling a
   * stream, and a CANCEL cancels its call.
   */
  maxHeaderBytes?: number;
  /** Called once when the host closes, with the error that closed it, if any. */
  onClose?: (err?: Error) => void;
}

export interface UnaryCallOptions {
  /**
   * Response timeout in ms; default 5000. On timeout the host cancels the call
   * on the server and the promise rejects with `undefined`. 0, or any value
   * outside 1 to 2^31-1, means no timeout.
   */
  timeout?: number;
}

// A call this host made, waiting for its responses.
interface PendingCall {
  // takes a response (a CALLBACK) to the call, frameBytes long
  handle(res: Call, frameBytes: number): void;
  // ends the call with err, cancelling it on the server if cancel is set
  fail(err: Error, cancel?: boolean): void;
}

// A call this host is serving, until it sends its last response or the
// peer cancels it.
interface ServedCall {
  id: bigint;
  done: boolean;
  stream?: Readable;
  // whether the host paused stream
  paused?: boolean;
}

/**
 * An RPC peer: it writes calls to w, reads frames from r, and serves the
 * peer's calls with service. Only r.on() is used; data chunks may split or
 * join frames anywhere.
 *
 * r's end, close or error event, or a malformed or oversized length prefix,
 * closes the host: pending calls fail, served calls are cancelled, and nothing
 * more is written. Half-close isn't supported.
 *
 * If w has once(), served streams are paused from a w.write() that returns
 * false until w emits drain, and requests refused for a limit meanwhile get no
 * reply.
 */
export default class Host {
  private w: Writable;
  private service: ServiceRegistry | undefined;
  private callId: bigint;
  // the calls this host made, by id
  private callbacks: Map<bigint, PendingCall>;
  // the calls this host is serving, by the peer's id for them, and all of
  // them, ids reused included
  private served: Map<bigint, ServedCall>;
  private serving: Set<ServedCall>;
  private argWriter: Writer;
  private callWriter: Writer;
  // the bytes read and not yet dispatched, their length, and the length the
  // next frame needs (0 until its length prefix is in)
  private chunks: Uint8Array[];
  private buffered: number;
  private need: number;
  // whether frames are being dispatched, this host is writing (and how many
  // writes deep), or a dispatch is queued for after the write
  private reading: boolean;
  private writing: number;
  private deferred: boolean;
  private closed: boolean;
  // whether w has once(), and whether its drain is awaited
  private canDrain: boolean;
  private blocked: boolean;
  private maxMessageBytes: number;
  private maxStreamBufferBytes: number;
  private maxConcurrentCalls: number;
  private maxHeaders: number;
  private maxHeaderBytes: number;
  private onClose: ((err?: Error) => void) | undefined;

  constructor(w: Writable, r: Readable, service?: ServiceRegistry, options: HostOptions = {}) {
    this.w = w;
    this.service = service;
    this.callId = BigInt(0);
    this.callbacks = new Map<bigint, PendingCall>();
    this.served = new Map<bigint, ServedCall>();
    this.serving = new Set<ServedCall>();
    this.argWriter = new Writer();
    this.callWriter = new Writer();
    this.chunks = [];
    this.buffered = 0;
    this.need = 0;
    this.reading = false;
    this.writing = 0;
    this.deferred = false;
    this.closed = false;
    this.canDrain = typeof (w as { once?: unknown }).once === "function";
    this.blocked = false;
    this.maxMessageBytes = limit(options.maxMessageBytes, DEFAULT_MAX_MESSAGE_BYTES);
    this.maxStreamBufferBytes = limit(
      options.maxStreamBufferBytes,
      Math.max(
        MIN_DEFAULT_STREAM_BUFFER_BYTES,
        4 * (isFinite(this.maxMessageBytes) ? this.maxMessageBytes : 0)
      )
    );
    this.maxConcurrentCalls = limit(options.maxConcurrentCalls, DEFAULT_MAX_CONCURRENT_CALLS);
    this.maxHeaders = limit(options.maxHeaders, DEFAULT_MAX_HEADERS);
    this.maxHeaderBytes = limit(options.maxHeaderBytes, DEFAULT_MAX_HEADER_BYTES);
    this.onClose = options.onClose;

    r.on("data", (data: ArrayBufferView | ArrayBuffer) => this.handleData(data));
    const shutdown = () => this.shutdown();
    r.on("end", shutdown);
    r.on("close", shutdown);
    r.on("error", (err: Error) => this.shutdown(err));
  }

  public call(
    method: string,
    arg: unknown,
    kind: Call_Kind = Call_Kind.CALL_KIND_DEFAULT,
    parentId = BigInt(0)
  ): Call {
    const call = this.newCall(method, arg, kind, parentId);
    this.send(call);
    return call;
  }

  // Makes the next call; it throws if arg won't encode.
  private newCall(method: string, arg: unknown, kind: Call_Kind, parentId: bigint): Call {
    const argument = (arg as Message<unknown>).constructor
      .encode(arg, this.argWriter.reset())
      .finish();
    return new Call({ id: ++this.callId, parentId, method, kind, argument });
  }

  // Writes call, unless the host has closed.
  private send(call: Call) {
    if (this.closed) {
      return;
    }
    this.writing++;
    let ok: boolean;
    try {
      ok = this.w.write(
        Call.encode(call, this.callWriter.reset().fork()).ldelim().finish().slice()
      );
    } finally {
      this.writing--;
    }
    if (ok === false && this.canDrain && !this.blocked) {
      this.blocked = true;
      this.w.once("drain", () => this.unblock());
      for (const served of Array.from(this.serving)) {
        this.pause(served);
      }
    }
  }

  private pause(served: ServedCall) {
    if (served.stream && !served.paused) {
      served.paused = true;
      served.stream.pause();
    }
  }

  // Resumes the served streams paused while w was full.
  private unblock() {
    this.blocked = false;
    if (this.closed) {
      return;
    }
    for (const served of Array.from(this.serving)) {
      if (served.paused) {
        served.paused = false;
        served.stream.resume();
      }
    }
  }

  public expectOne<T>(
    call: Call,
    Message: MessageClass<T>,
    { timeout }: UnaryCallOptions = {}
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(connectionClosed());
        return;
      }

      const ms = timeout === undefined ? CALL_TIMEOUT_MS : timeout;
      const tid =
        ms > 0 && ms <= MAX_TIMEOUT_MS
          ? setTimeout(() => {
              this.callbacks.delete(call.id);
              // callers tell a timeout by its undefined reason
              // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
              reject();
              this.cancel(call.id);
            }, ms)
          : undefined;

      const settle = () => {
        clearTimeout(tid);
        this.callbacks.delete(call.id);
      };

      this.callbacks.set(call.id, {
        handle: (res: Call) => {
          settle();
          switch (res.kind) {
            case Call_Kind.CALL_KIND_DEFAULT:
              try {
                resolve(Message.decode(res.argument));
              } catch (e) {
                reject(e as Error);
              }
              break;
            case Call_Kind.CALL_KIND_ERROR:
              // callers read the rpc.Error's code, and test for it with instanceof
              // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
              reject(decodeCallError(res.argument));
              break;
            default:
              reject(unexpectedKind(res.kind));
          }
        },
        fail: (err: Error) => {
          settle();
          reject(err);
        },
      });
    });
  }

  public expectMany<T>(call: Call, Message: MessageClass<T>): GenericReadable<T> {
    // Items not yet pushed, and how the stream ends once they are read: an
    // error, or null for CLOSE. Items are pushed only on read (highWaterMark
    // 0), so destroying the stream with the error drops none.
    const queue: { v: T; cost: number }[] = [];
    // the sum of the queued items' costs
    let queued = 0;
    let ending: { err: Error | null } | undefined;
    // whether the consumer has asked for an item it hasn't been given
    let wanted = false;

    const flush = () => {
      if (!wanted || e.destroyed) {
        return;
      }
      if (queue.length > 0) {
        wanted = false;
        const { v, cost } = queue.shift();
        queued -= cost;
        e.push(v);
      } else if (ending) {
        wanted = false;
        const { err } = ending;
        if (err) {
          // after the read() that asked, so the last item is delivered first
          void Promise.resolve().then(() => e.destroy(err));
        } else {
          e.push(null);
        }
      }
    };

    // autoDestroy, so readable-stream 3 (browsers) emits close after end too
    const e = new Readable({
      objectMode: true,
      highWaterMark: 0,
      autoDestroy: true,
      read: () => {
        wanted = true;
        flush();
      },
    });

    // Ends the stream once the consumer has read every item; at once if
    // there are none to read.
    const end = (err: Error | null) => {
      if (queue.length === 0 && (!err || e.readableLength === 0)) {
        if (err) {
          e.destroy(err);
        } else {
          e.push(null);
        }
        return;
      }
      ending = { err };
      flush();
    };

    if (this.closed) {
      e.destroy(connectionClosed());
      return e;
    }

    // the consumer closed the stream before it ended: cancel the call
    const handleClose = () => {
      this.callbacks.delete(call.id);
      if (!this.closed) {
        this.cancel(call.id);
      }
    };
    e.on("close", handleClose);

    // the server ended the stream, or the connection closed: nothing to cancel
    const finish = () => {
      this.callbacks.delete(call.id);
      e.off("close", handleClose);
    };

    const abort = (err: Error) => {
      finish();
      this.cancel(call.id);
      end(err);
    };

    this.callbacks.set(call.id, {
      handle: (res: Call, frameBytes: number) => {
        switch (res.kind) {
          case Call_Kind.CALL_KIND_DEFAULT: {
            const cost = frameBytes + RESPONSE_OVERHEAD + HEADER_OVERHEAD * res.headers.size;
            if (queue.length > 0 && queued + cost > this.maxStreamBufferBytes) {
              queue.length = 0;
              queued = 0;
              abort(streamBufferFull() as Error);
              break;
            }
            let v: T;
            try {
              v = Message.decode(res.argument);
            } catch (err) {
              abort(err as Error);
              break;
            }
            queue.push({ v, cost });
            queued += cost;
            flush();
            break;
          }
          case Call_Kind.CALL_KIND_ERROR:
            finish();
            // consumers read the rpc.Error's code, and test for it with instanceof
            end(decodeCallError(res.argument) as Error);
            break;
          case Call_Kind.CALL_KIND_CLOSE:
            finish();
            end(null);
            break;
          default:
            finish();
            end(unexpectedKind(res.kind));
        }
      },
      fail: (err: Error, cancel?: boolean) => {
        if (cancel) {
          abort(err);
        } else {
          finish();
          end(err);
        }
      },
    });

    return e;
  }

  // Asks the peer to stop serving call id.
  private cancel(id: bigint) {
    this.call(CANCEL_METHOD, new Cancel(), Call_Kind.CALL_KIND_CANCEL, id);
  }

  private handleData(data: ArrayBufferView | ArrayBuffer) {
    if (this.closed) {
      return;
    }
    const chunk = toBytes(data);
    this.chunks.push(chunk);
    this.buffered += chunk.byteLength;

    // the running or deferred read() takes this data, keeping frames in order
    if (this.reading || this.deferred) {
      return;
    }
    // a synchronous peer can reply mid-write, before expectOne: defer dispatch
    if (this.writing > 0) {
      this.deferred = true;
      void Promise.resolve().then(() => {
        this.deferred = false;
        this.read();
      });
      return;
    }
    this.read();
  }

  // Dispatches each whole frame read.
  private read() {
    this.reading = true;
    try {
      for (let frame = this.nextFrame(); frame; frame = this.nextFrame()) {
        this.handleFrame(frame);
      }
    } finally {
      this.reading = false;
    }
  }

  // Takes the next whole frame off the bytes read, or returns undefined until
  // it is all in. Each is a varint length, then a Call that long.
  private nextFrame(): Uint8Array | undefined {
    if (this.closed || this.buffered === 0 || this.buffered < this.need) {
      return undefined;
    }

    let buf = this.chunks[0];
    if (this.chunks.length > 1) {
      buf = concat(this.chunks, this.buffered);
      this.chunks = [buf];
    }

    let len = 0;
    let n = 0;
    for (let b = 128; b > 127; n++) {
      if (n === buf.byteLength) {
        return undefined;
      }
      if (n === 5) {
        // no length is this long: the stream is corrupt, and can't be resynced
        const err = malformedLength();
        this.shutdown(err, () => err);
        return undefined;
      }
      b = buf[n];
      len += (b & 127) * 2 ** (7 * n);
    }

    if (len > this.maxMessageBytes) {
      const err = messageTooLarge();
      this.shutdown(err, () => err);
      return undefined;
    }

    const end = n + len;
    if (end > buf.byteLength) {
      this.need = end;
      return undefined;
    }

    // a copy, unless buf holds no bytes past this frame
    const frame =
      buf.buffer.byteLength > end ? new Uint8Array(buf.subarray(n, end)) : buf.subarray(n, end);
    const rest = buf.subarray(end);
    this.chunks = rest.byteLength === 0 ? [] : [rest];
    this.buffered = rest.byteLength;
    this.need = 0;
    return frame;
  }

  // Dispatches frame. One over a header limit isn't decoded.
  private handleFrame(frame: Uint8Array) {
    let env: Envelope;
    let call: Call | undefined;
    let method: string;
    try {
      env = scanCall(frame);
      if (env.headers <= this.maxHeaders && env.headerBytes <= this.maxHeaderBytes) {
        call = Call.decode(frame);
        method = call.method;
      } else {
        method = methodOf(frame, env);
      }
    } catch {
      // a frame that doesn't decode is dropped
      return;
    }

    try {
      switch (method) {
        case CALLBACK_METHOD: {
          // a response to a call this host made; ignored once the call is over
          const pending = this.callbacks.get(env.parentId);
          if (call) {
            pending?.handle(call, frame.byteLength);
          } else {
            pending?.fail(tooManyHeaders(), true);
          }
          break;
        }
        case CANCEL_METHOD:
          // matched by method: the Go runtime sends CANCEL as CALL_KIND_DEFAULT
          this.cancelServed(env.parentId);
          break;
        default:
          if (call) {
            this.handleCall(call);
          } else {
            this.refuse(env.id, new RPCError({ message: "rpc: too many headers" }));
          }
      }
    } catch (e) {
      // a listener's error: rethrown later, so the read loop can go on
      setTimeout(() => {
        throw e;
      });
    }
  }

  // Answers request id with err, unless w is full.
  private refuse(id: bigint, err: RPCError) {
    if (!this.blocked) {
      this.reply(id, err, Call_Kind.CALL_KIND_ERROR);
    }
  }

  private handleCall(call: Call) {
    if (this.serving.size >= this.maxConcurrentCalls) {
      this.refuse(
        call.id,
        new RPCError({
          message: "rpc: too many concurrent calls",
          code: TOO_MANY_CONCURRENT_CALLS,
        })
      );
      return;
    }

    const methods = this.service?.methods;
    if (!methods || !Object.prototype.hasOwnProperty.call(methods, call.method)) {
      this.reply(
        call.id,
        new RPCError({ message: `method not implemented: ${call.method}` }),
        Call_Kind.CALL_KIND_ERROR
      );
      return;
    }
    const method = methods[call.method];

    let res: unknown;
    try {
      res = method.callback(method.reqType.decode(call.argument), call);
    } catch (e) {
      res = toCallError(e);
    }

    if (res instanceof Promise) {
      const served = this.serve(call.id);
      const settle = (v: unknown) => {
        if (!served.done) {
          this.unserve(served);
          this.respond(call.id, v);
        } else if (v instanceof Readable) {
          // cancelled before the handler's promise settled
          v.destroy();
        }
      };
      void res.then(settle, (e: unknown) => settle(toCallError(e)));
    } else {
      this.respond(call.id, res);
    }
  }

  // Answers call id with res, its handler's result.
  private respond(id: bigint, res: unknown) {
    if (res instanceof Readable) {
      this.serveStream(id, res);
    } else if (res instanceof RPCError) {
      this.reply(id, res, Call_Kind.CALL_KIND_ERROR);
    } else if (res === undefined) {
      this.reply(id, new Undefined(), Call_Kind.CALL_KIND_UNDEFINED);
    } else {
      this.reply(id, res, Call_Kind.CALL_KIND_DEFAULT);
    }
  }

  // Sends a response to call id. If res won't encode, it sends an error
  // instead and returns false.
  private reply(id: bigint, res: unknown, kind: Call_Kind): boolean {
    let call: Call;
    let encoded = true;
    try {
      call = this.newCall(CALLBACK_METHOD, res, kind, id);
    } catch (e) {
      call = this.newCall(CALLBACK_METHOD, toCallError(e), Call_Kind.CALL_KIND_ERROR, id);
      encoded = false;
    }
    this.send(call);
    return encoded;
  }

  // Sends the stream's items, then one CLOSE when it ends, or one ERROR if it
  // errors, unless the peer cancels it first.
  private serveStream(id: bigint, stream: Readable) {
    const served = this.serve(id, stream);

    const finish = (res: unknown, kind: Call_Kind) => {
      if (!served.done) {
        this.unserve(served);
        this.reply(id, res, kind);
      }
    };

    stream.on("data", (v: unknown) => {
      if (!served.done && !this.reply(id, v, Call_Kind.CALL_KIND_DEFAULT)) {
        this.unserve(served);
        stream.destroy();
      }
    });
    stream.on("end", () => finish(new Close(), Call_Kind.CALL_KIND_CLOSE));
    stream.on("error", (e: unknown) => finish(toCallError(e), Call_Kind.CALL_KIND_ERROR));
    // destroyed, with no error, before it ended
    stream.on("close", () => finish(new Close(), Call_Kind.CALL_KIND_CLOSE));
    if (this.blocked) {
      this.pause(served);
    }

    // An already finished stream may have emitted its last event; a timer runs
    // after any still pending on process.nextTick.
    if (stream.destroyed || hasEnded(stream)) {
      setTimeout(() => {
        const { errored } = stream as { errored?: unknown };
        if (errored) {
          finish(toCallError(errored), Call_Kind.CALL_KIND_ERROR);
        } else {
          finish(new Close(), Call_Kind.CALL_KIND_CLOSE);
        }
      });
    }
  }

  private serve(id: bigint, stream?: Readable): ServedCall {
    const served: ServedCall = { id, done: false, stream };
    this.served.set(id, served);
    this.serving.add(served);
    return served;
  }

  private unserve(served: ServedCall) {
    served.done = true;
    this.serving.delete(served);
    if (this.served.get(served.id) === served) {
      this.served.delete(served.id);
    }
  }

  // Stops serving the call and sends nothing more for it; a stream is
  // destroyed without an error.
  private stopServing(served: ServedCall) {
    this.unserve(served);
    served.stream?.destroy();
  }

  private cancelServed(id: bigint) {
    const served = this.served.get(id);
    if (served) {
      this.stopServing(served);
    }
  }

  // Closes the host with err, the error that closed it, if any: dispatches
  // the whole frames already read, then fails pending calls with callErr(),
  // cancels served ones, stops writing and calls onClose.
  private shutdown(err?: Error, callErr: () => Error = connectionClosed) {
    if (this.closed) {
      return;
    }
    if (!this.reading) {
      this.read();
      if (this.closed) {
        return;
      }
    }
    this.closed = true;
    this.chunks = [];
    this.buffered = 0;
    this.need = 0;

    const pending = Array.from(this.callbacks.values());
    this.callbacks.clear();
    for (const call of pending) {
      call.fail(callErr());
    }

    for (const served of Array.from(this.serving)) {
      this.stopServing(served);
    }

    this.onClose?.(err);
  }
}
