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
const MIN_DEFAULT_WRITE_BUFFER_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT_CALLS = 128;
const DEFAULT_MAX_HEADERS = 64;
const DEFAULT_MAX_HEADER_BYTES = 64 * 1024;
const DEFAULT_MAX_MALFORMED_FRAMES = 64;
// what a queued stream response is charged beyond its frame
const RESPONSE_OVERHEAD = 256;
const HEADER_OVERHEAD = 128;

// a length prefix's most bytes
const MAX_PREFIX_BYTES = 5;
// a partial frame buffer's least size
const MIN_PARTIAL_BYTES = 1024;
// the frames dispatched before the rest wait for a timer, unless more than
// MAX_INPUT_BACKLOG bytes are waiting
const FRAMES_PER_TURN = 1024;
const MAX_INPUT_BACKLOG = 1024 * 1024;

const ZERO = BigInt(0);
const EMPTY = new Uint8Array(0);

// strims.rpc.errors.ErrorCode values
const TOO_MANY_CONCURRENT_CALLS = 1003;
const OVERFLOW = 1010;

const connectionClosed = (): Error => new Error("rpc: connection closed");
const messageTooLarge = (): Error => new Error("rpc: message too large");
const malformedLength = (): Error => new Error("rpc: malformed message length");
const tooManyHeaders = (): Error => new Error("rpc: too many headers");
const peerNotReading = (): Error => new Error("rpc: peer not reading");
const tooManyMalformedFrames = (): Error => new Error("rpc: too many malformed frames");
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

// frame as a plain Uint8Array, copied unless its buffer holds no more than
// frame and a length prefix
const own = (frame: Uint8Array): Uint8Array =>
  frame.buffer.byteLength > frame.byteLength + MAX_PREFIX_BYTES
    ? new Uint8Array(frame)
    : new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);

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

// Reads frame's envelope, taking the levels Call.decode takes. It throws
// unless frame is a Call that Call.decode takes whose known fields, and its
// header entries' keys and values, have their wire types.
const scanCall = (frame: Uint8Array): Envelope => {
  const env: Envelope = {
    id: BigInt(0),
    parentId: BigInt(0),
    methodPos: -1,
    headers: 0,
    headerBytes: 0,
  };
  const r = new Reader(frame);
  r.enter();
  while (r.pos < r.end) {
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
        r.skipType(wireType, field);
        break;
      case 6: {
        const len = r.uint32();
        const parentEnd = r.enter(len);
        while (r.pos < r.end) {
          const entryTag = r.uint32();
          const entryField = entryTag >>> 3;
          if ((entryField === 1 || entryField === 2) && (entryTag & 7) !== LEN) {
            throw malformedCall();
          }
          r.skipType(entryTag & 7, entryField);
        }
        r.leave(parentEnd);
        env.headers++;
        env.headerBytes += len;
        break;
      }
      default:
        r.skipType(wireType, field);
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
  /**
   * The bytes w may hold unwritten, as w.writableLength reports them; default
   * the larger of 16 MiB and 4 × maxMessageBytes. A write that leaves more
   * closes the host with Error("rpc: peer not reading"). Not checked if w has
   * no writableLength.
   */
  maxWriteBufferBytes?: number;
  /**
   * The malformed frames the host drops before it closes with Error("rpc: too
   * many malformed frames"); default 64. Counts frames that don't decode,
   * requests with id 0, and requests whose argument doesn't decode (which are
   * still refused), not frames over a header limit or responses to unknown
   * calls.
   */
  maxMalformedFrames?: number;
  /**
   * Called once when the host closes, with the error that closed it, if any.
   * Its throw is rethrown from a timer.
   */
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
 * false until w emits drain, and requests refused meanwhile get no reply.
 * Requests with id 0 get no reply.
 *
 * Frames are dispatched in order, up to 1024 per turn of the event loop while
 * no more than 1 MiB of them is waiting.
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
  // the chunks read and not yet parsed, the offset of the first's next byte,
  // and their bytes left
  private input: Uint8Array[];
  private inputPos: number;
  private backlog: number;
  // the length prefix being read: its value so far and its bytes
  private prefixLen: number;
  private prefixBytes: number;
  // the frame being put together from chunks, its bytes in, and its length
  private partial: Uint8Array | undefined;
  private filled: number;
  private need: number;
  // whether frames are being dispatched, this host is writing (and how many
  // writes deep), a dispatch is queued for after the write, or the rest of the
  // frames read wait for a timer
  private reading: boolean;
  private writing: number;
  private deferred: boolean;
  private resumeTimer: ReturnType<typeof setTimeout> | undefined;
  // the close that waits for the frames read to be dispatched
  private closing: (() => void) | undefined;
  private closed: boolean;
  // whether w has once(), and whether its drain is awaited
  private canDrain: boolean;
  private blocked: boolean;
  private maxMessageBytes: number;
  private maxStreamBufferBytes: number;
  private maxConcurrentCalls: number;
  private maxHeaders: number;
  private maxHeaderBytes: number;
  private maxWriteBufferBytes: number;
  private maxMalformedFrames: number;
  // the malformed frames dropped
  private malformedFrames: number;
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
    this.input = [];
    this.inputPos = 0;
    this.backlog = 0;
    this.prefixLen = 0;
    this.prefixBytes = 0;
    this.partial = undefined;
    this.filled = 0;
    this.need = 0;
    this.reading = false;
    this.writing = 0;
    this.deferred = false;
    this.resumeTimer = undefined;
    this.closing = undefined;
    this.closed = false;
    this.canDrain = typeof (w as { once?: unknown }).once === "function";
    this.blocked = false;
    this.maxMessageBytes = limit(options.maxMessageBytes, DEFAULT_MAX_MESSAGE_BYTES);
    const messageBytes = isFinite(this.maxMessageBytes) ? this.maxMessageBytes : 0;
    this.maxStreamBufferBytes = limit(
      options.maxStreamBufferBytes,
      Math.max(MIN_DEFAULT_STREAM_BUFFER_BYTES, 4 * messageBytes)
    );
    this.maxConcurrentCalls = limit(options.maxConcurrentCalls, DEFAULT_MAX_CONCURRENT_CALLS);
    this.maxHeaders = limit(options.maxHeaders, DEFAULT_MAX_HEADERS);
    this.maxHeaderBytes = limit(options.maxHeaderBytes, DEFAULT_MAX_HEADER_BYTES);
    this.maxWriteBufferBytes = limit(
      options.maxWriteBufferBytes,
      Math.max(MIN_DEFAULT_WRITE_BUFFER_BYTES, 4 * messageBytes)
    );
    this.maxMalformedFrames = limit(options.maxMalformedFrames, DEFAULT_MAX_MALFORMED_FRAMES);
    this.malformedFrames = 0;
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
    const { writableLength } = this.w as { writableLength?: unknown };
    if (typeof writableLength === "number" && writableLength > this.maxWriteBufferBytes) {
      const err = peerNotReading();
      this.close(err, () => err);
      return;
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
    // Responses not yet pushed, each with its charge, the first one decoded,
    // and how the stream ends once they are read: an error, or null for CLOSE.
    // Items are pushed only on read (highWaterMark 0), so destroying the
    // stream with the error drops none.
    const queue: { arg?: Uint8Array; v?: T; cost: number }[] = [];
    // the sum of the queued responses' charges
    let queued = 0;
    let ending: { err: Error | null } | undefined;
    // whether the consumer has asked for an item it hasn't been given
    let wanted = false;
    // whether the call's responses still come to this stream
    let open = true;

    const flush = () => {
      if (!wanted || e.destroyed) {
        return;
      }
      if (queue.length > 0) {
        wanted = false;
        const { v, cost } = queue.shift();
        queued -= cost;
        e.push(v);
        decodeFirst();
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
      open = false;
      this.callbacks.delete(call.id);
      e.off("close", handleClose);
    };

    // ends the stream with err, cancelling the call if it is open
    const abort = (err: Error) => {
      if (open) {
        finish();
        this.cancel(call.id);
      }
      end(err);
    };

    // Decodes the first queued response. If it doesn't decode, it and the
    // rest are dropped and the stream ends with the error.
    const decodeFirst = () => {
      const first = queue[0];
      if (first?.arg) {
        try {
          first.v = Message.decode(first.arg);
          first.arg = undefined;
        } catch (err) {
          queue.length = 0;
          queued = 0;
          abort(err as Error);
        }
      }
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
            queue.push({ arg: res.argument, cost });
            queued += cost;
            if (queue.length === 1) {
              decodeFirst();
            }
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
    this.input.push(chunk);
    this.backlog += chunk.byteLength;

    // the running, deferred or scheduled read() takes this data, keeping
    // frames in order
    if (
      this.reading ||
      this.deferred ||
      (this.resumeTimer !== undefined && this.backlog <= MAX_INPUT_BACKLOG)
    ) {
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

  // Dispatches the whole frames read, FRAMES_PER_TURN at a time while no more
  // than MAX_INPUT_BACKLOG bytes wait, the rest from a timer.
  private read() {
    if (this.resumeTimer !== undefined) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = undefined;
    }
    this.reading = true;
    try {
      for (let n = 1; ; n++) {
        const frame = this.nextFrame();
        if (!frame) {
          break;
        }
        this.handleFrame(frame);
        if (
          n % FRAMES_PER_TURN === 0 &&
          this.backlog > 0 &&
          this.backlog <= MAX_INPUT_BACKLOG &&
          !this.closed
        ) {
          this.resumeTimer = setTimeout(() => {
            this.resumeTimer = undefined;
            this.read();
          });
          break;
        }
      }
    } finally {
      this.reading = false;
    }
    if (this.closing && this.resumeTimer === undefined) {
      const close = this.closing;
      this.closing = undefined;
      close();
    }
  }

  // Takes the next whole frame off the bytes read, or returns undefined until
  // it is all in. Each is a varint length, then a Call that long.
  private nextFrame(): Uint8Array | undefined {
    while (!this.closed && this.input.length > 0) {
      const chunk = this.input[0];
      let pos = this.inputPos;
      if (pos === chunk.byteLength) {
        this.input.shift();
        this.inputPos = 0;
        continue;
      }

      if (this.partial) {
        const n = Math.min(this.need - this.filled, chunk.byteLength - pos);
        this.grow(this.filled + n);
        this.partial.set(chunk.subarray(pos, pos + n), this.filled);
        this.filled += n;
        this.inputPos = pos + n;
        this.backlog -= n;
        if (this.filled < this.need) {
          continue;
        }
        const frame = this.partial;
        this.partial = undefined;
        return frame;
      }

      let b = 128;
      while (b > 127 && pos < chunk.byteLength) {
        if (this.prefixBytes === MAX_PREFIX_BYTES) {
          // no length is this long: the stream is corrupt, and can't be resynced
          const err = malformedLength();
          this.close(err, () => err);
          return undefined;
        }
        b = chunk[pos++];
        this.prefixLen += (b & 127) * 2 ** (7 * this.prefixBytes++);
      }
      this.backlog -= pos - this.inputPos;
      this.inputPos = pos;
      if (b > 127) {
        continue;
      }
      const len = this.prefixLen;
      this.prefixLen = 0;
      this.prefixBytes = 0;

      if (len > this.maxMessageBytes) {
        const err = messageTooLarge();
        this.close(err, () => err);
        return undefined;
      }
      if (len === 0) {
        return EMPTY;
      }
      if (chunk.byteLength - pos >= len) {
        this.inputPos = pos + len;
        this.backlog -= len;
        return own(chunk.subarray(pos, pos + len));
      }
      this.partial = EMPTY;
      this.filled = 0;
      this.need = len;
    }
    return undefined;
  }

  // Grows the partial frame to hold at least size bytes, doubling it, up to
  // its length.
  private grow(size: number) {
    if (size > this.partial.byteLength) {
      const buf = new Uint8Array(
        Math.min(this.need, Math.max(size, 2 * this.partial.byteLength, MIN_PARTIAL_BYTES))
      );
      buf.set(this.partial.subarray(0, this.filled));
      this.partial = buf;
    }
  }

  // Dispatches frame. One over a header limit isn't decoded; a request with
  // id 0, an empty frame among them, is dropped as malformed.
  private handleFrame(frame: Uint8Array) {
    if (frame.byteLength === 0) {
      this.dropMalformed();
      return;
    }
    let env: Envelope;
    let call: Call | undefined;
    let method: string;
    try {
      env = scanCall(frame);
      const within = env.headers <= this.maxHeaders && env.headerBytes <= this.maxHeaderBytes;
      if (!within || env.id === ZERO) {
        method = methodOf(frame, env);
        if (env.id === ZERO && method !== CALLBACK_METHOD && method !== CANCEL_METHOD) {
          this.dropMalformed();
          return;
        }
      }
      if (within) {
        call = Call.decode(frame);
        method = call.method;
      }
    } catch {
      this.dropMalformed();
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

  // Counts a malformed frame dropped, closing the host at maxMalformedFrames.
  private dropMalformed() {
    if (++this.malformedFrames >= this.maxMalformedFrames) {
      const err = tooManyMalformedFrames();
      this.close(err, () => err);
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
      this.refuse(call.id, new RPCError({ message: `method not implemented: ${call.method}` }));
      return;
    }
    const method = methods[call.method];

    let arg: unknown;
    try {
      arg = method.reqType.decode(call.argument);
    } catch (e) {
      this.refuse(call.id, toCallError(e));
      this.dropMalformed();
      return;
    }

    let res: unknown;
    try {
      res = method.callback(arg, call);
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

  // Closes the host, as close does, once the whole frames already read are
  // dispatched.
  private shutdown(err?: Error) {
    if (this.closed || this.closing) {
      return;
    }
    if (!this.reading) {
      this.read();
      if (this.closed) {
        return;
      }
    }
    if (this.resumeTimer !== undefined) {
      this.closing = () => this.close(err);
      return;
    }
    this.close(err);
  }

  // Closes the host with err, the error that closed it, if any: fails pending
  // calls with callErr(), cancels served ones, stops reading and writing, and
  // calls onClose.
  private close(err?: Error, callErr: () => Error = connectionClosed) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.closing = undefined;
    clearTimeout(this.resumeTimer);
    this.resumeTimer = undefined;
    this.input = [];
    this.backlog = 0;
    this.partial = undefined;

    const pending = Array.from(this.callbacks.values());
    this.callbacks.clear();
    for (const call of pending) {
      call.fail(callErr());
    }

    for (const served of Array.from(this.serving)) {
      this.stopServing(served);
    }

    try {
      this.onClose?.(err);
    } catch (e) {
      setTimeout(() => {
        throw e;
      });
    }
  }
}
