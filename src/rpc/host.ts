import { PassThrough, Readable, Writable } from "stream";

import {
  Call,
  Call_Kind,
  Cancel,
  Close,
  Error as RPCError,
  Undefined,
} from "../apis/strims/rpc/rpc";
import { Message, MessageClass } from "../pb/message";
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

const connectionClosed = (): Error => new Error("rpc: connection closed");

// The error for a response of a kind the call can't take.
const unexpectedKind = (kind: Call_Kind): Error =>
  new Error(`rpc: unexpected response kind ${Call_Kind[kind] ?? kind}`);

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
  // takes a response (a CALLBACK) to the call
  handle(res: Call): void;
  // ends the call with err
  fail(err: Error): void;
}

// A call this host is serving, until it sends its last response or the
// peer cancels it.
interface ServedCall {
  done: boolean;
  stream?: Readable;
}

/**
 * An RPC peer: it writes calls to w, reads frames from r, and serves the
 * peer's calls with service. Only r.on() is used; data chunks may split or
 * join frames anywhere.
 *
 * r only needs on(). Its data chunks (Buffers, Uint8Arrays or ArrayBuffers)
 * may split or join frames anywhere. Its end, close and error events all end
 * the host: calls it made fail, and calls it serves are cancelled. Half-closed
 * connections aren't supported.
 */
export default class Host {
  private w: Writable;
  private service: ServiceRegistry | undefined;
  private callId: bigint;
  // the calls this host made, by id
  private callbacks: Map<bigint, PendingCall>;
  // the calls this host is serving, by the peer's id for them
  private served: Map<bigint, ServedCall>;
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

  constructor(w: Writable, r: Readable, service?: ServiceRegistry) {
    this.w = w;
    this.service = service;
    this.callId = BigInt(0);
    this.callbacks = new Map<bigint, PendingCall>();
    this.served = new Map<bigint, ServedCall>();
    this.argWriter = new Writer();
    this.callWriter = new Writer();
    this.chunks = [];
    this.buffered = 0;
    this.need = 0;
    this.reading = false;
    this.writing = 0;
    this.deferred = false;
    this.closed = false;

    r.on("data", (data: ArrayBufferView | ArrayBuffer) => this.handleData(data));
    const shutdown = () => this.shutdown();
    r.on("end", shutdown);
    r.on("close", shutdown);
    r.on("error", shutdown);
  }

  public call(
    method: string,
    arg: unknown,
    kind: Call_Kind = Call_Kind.CALL_KIND_DEFAULT,
    parentId = BigInt(0)
  ): Call {
    const call = new Call({
      id: ++this.callId,
      parentId,
      method,
      kind,
      argument: (arg as Message<unknown>).constructor.encode(arg, this.argWriter.reset()).finish(),
    });

    this.writing++;
    try {
      this.w.write(Call.encode(call, this.callWriter.reset().fork()).ldelim().finish().slice());
    } finally {
      this.writing--;
    }

    return call;
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
    // autoDestroy, so readable-stream 3 (browsers) emits close after end too
    const e = new PassThrough({
      objectMode: true,
      autoDestroy: true,
    });

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

    this.callbacks.set(call.id, {
      handle: (res: Call) => {
        switch (res.kind) {
          case Call_Kind.CALL_KIND_DEFAULT: {
            let v: T;
            try {
              v = Message.decode(res.argument);
            } catch (err) {
              // closing cancels the call
              e.destroy(err as Error);
              break;
            }
            e.push(v);
            break;
          }
          case Call_Kind.CALL_KIND_ERROR:
            finish();
            // consumers read the rpc.Error's code, and test for it with instanceof
            e.destroy(decodeCallError(res.argument) as Error);
            break;
          case Call_Kind.CALL_KIND_CLOSE:
            finish();
            e.end();
            break;
          default:
            finish();
            e.destroy(unexpectedKind(res.kind));
        }
      },
      fail: (err: Error) => {
        finish();
        e.destroy(err);
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
        this.shutdown();
        return undefined;
      }
      b = buf[n];
      len += (b & 127) * 2 ** (7 * n);
    }

    const end = n + len;
    if (end > buf.byteLength) {
      this.need = end;
      return undefined;
    }

    const frame = buf.subarray(n, end);
    const rest = buf.subarray(end);
    this.chunks = rest.byteLength === 0 ? [] : [rest];
    this.buffered = rest.byteLength;
    this.need = 0;
    return frame;
  }

  private handleFrame(frame: Uint8Array) {
    let call: Call;
    try {
      call = Call.decode(frame);
    } catch {
      // a frame that doesn't decode is dropped
      return;
    }

    try {
      switch (call.method) {
        case CALLBACK_METHOD:
          // a response to a call this host made; ignored once the call is over
          this.callbacks.get(call.parentId)?.handle(call);
          break;
        case CANCEL_METHOD:
          // matched by method: the Go runtime sends CANCEL as CALL_KIND_DEFAULT
          this.cancelServed(call.parentId);
          break;
        default:
          this.handleCall(call);
      }
    } catch (e) {
      // a listener's error: rethrown later, so the read loop can go on
      setTimeout(() => {
        throw e;
      });
    }
  }

  private handleCall(call: Call) {
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
      const served: ServedCall = { done: false };
      this.served.set(call.id, served);
      const settle = (v: unknown) => {
        if (!served.done) {
          this.unserve(call.id, served);
          this.respond(call.id, v);
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

  // Sends a response to call id. One that won't encode (a plain object, say)
  // is answered with an error instead, and reply returns false.
  private reply(id: bigint, res: unknown, kind: Call_Kind): boolean {
    try {
      this.call(CALLBACK_METHOD, res, kind, id);
      return true;
    } catch (e) {
      this.call(CALLBACK_METHOD, toCallError(e), Call_Kind.CALL_KIND_ERROR, id);
      return false;
    }
  }

  // Sends the stream's items, then one CLOSE when it ends, or one ERROR if it
  // errors, unless the peer cancels it first.
  private serveStream(id: bigint, stream: Readable) {
    const served: ServedCall = { done: false, stream };
    this.served.set(id, served);

    const finish = (res: unknown, kind: Call_Kind) => {
      if (!served.done) {
        this.unserve(id, served);
        this.reply(id, res, kind);
      }
    };

    stream.on("data", (v: unknown) => {
      if (!served.done && !this.reply(id, v, Call_Kind.CALL_KIND_DEFAULT)) {
        this.unserve(id, served);
        stream.destroy();
      }
    });
    stream.on("end", () => finish(new Close(), Call_Kind.CALL_KIND_CLOSE));
    stream.on("error", (e: unknown) => finish(toCallError(e), Call_Kind.CALL_KIND_ERROR));
    // destroyed, with no error, before it ended
    stream.on("close", () => finish(new Close(), Call_Kind.CALL_KIND_CLOSE));
  }

  private unserve(id: bigint, served: ServedCall) {
    served.done = true;
    if (this.served.get(id) === served) {
      this.served.delete(id);
    }
  }

  // Stops serving call id and sends nothing more for it; a stream is destroyed
  // without an error.
  private cancelServed(id: bigint) {
    const served = this.served.get(id);
    if (served) {
      this.unserve(id, served);
      served.stream?.destroy();
    }
  }

  // The connection is gone, as the Go runtime takes a closed transport: the
  // calls this host made fail, and those it serves are cancelled.
  private shutdown() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.chunks = [];
    this.buffered = 0;
    this.need = 0;

    const pending = Array.from(this.callbacks.values());
    this.callbacks.clear();
    for (const call of pending) {
      call.fail(connectionClosed());
    }

    for (const id of Array.from(this.served.keys())) {
      this.cancelServed(id);
    }
  }
}
