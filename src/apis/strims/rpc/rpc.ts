import Reader from "../../../pb/reader";
import Writer from "../../../pb/writer";


export type ICall = {
  id?: bigint;
  parentId?: bigint;
  method?: string;
  kind?: Call.Kind;
  argument?: Uint8Array;
  headers?: Map<string, Uint8Array> | { [key: string]: Uint8Array };
}

export class Call {
  id: bigint;
  parentId: bigint;
  method: string;
  kind: Call.Kind;
  argument: Uint8Array;
  headers: Map<string, Uint8Array>;

  constructor(v?: ICall) {
    this.id = v?.id || BigInt(0);
    this.parentId = v?.parentId || BigInt(0);
    this.method = v?.method || "";
    this.kind = v?.kind || 0;
    this.argument = v?.argument || new Uint8Array();
    if (v?.headers) this.headers = new Map(v.headers instanceof Map ? v.headers : Object.entries(v.headers));
    else this.headers = new Map<string, Uint8Array>();
  }

  static encode(m: Call, w?: Writer): Writer {
    if (!w) w = new Writer();
    if (m.id) w.uint32(8).uint64(m.id);
    if (m.parentId) w.uint32(16).uint64(m.parentId);
    if (m.method.length) w.uint32(26).string(m.method);
    if (m.kind) w.uint32(32).uint32(m.kind);
    if (m.argument.length) w.uint32(42).bytes(m.argument);
    for (const [k, v] of m.headers) w.uint32(50).fork().uint32(10).string(k).uint32(18).bytes(v).ldelim();
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): Call {
    r = r instanceof Reader ? r : new Reader(r);
    const end = length === undefined ? r.len : r.pos + length;
    const m = new Call();
    while (r.pos < end) {
      const tag = r.uint32();
      switch (tag >> 3) {
        case 1:
        m.id = r.uint64();
        break;
        case 2:
        m.parentId = r.uint64();
        break;
        case 3:
        m.method = r.string();
        break;
        case 4:
        m.kind = r.uint32();
        break;
        case 5:
        m.argument = r.bytes();
        break;
        case 6:
        {
          const flen = r.uint32();
          const fend = r.pos + flen;
          let key: string;
          let value: Uint8Array;
          while (r.pos < fend) {
            const ftag = r.uint32();
            switch (ftag >> 3) {
              case 1:
              key = r.string()
              break;
              case 2:
              value = r.bytes();
              break;
            }
          }
          m.headers.set(key, value)
        }
        break;
        default:
        r.skipType(tag & 7);
        break;
      }
    }
    return m;
  }
}

export namespace Call {
  export enum Kind {
    CALL_KIND_DEFAULT = 0,
    CALL_KIND_ERROR = 1,
    CALL_KIND_CANCEL = 2,
    CALL_KIND_CLOSE = 3,
    CALL_KIND_UNDEFINED = 4,
  }
}

export type IError = {
  message?: string;
  code?: number;
}

export class Error {
  message: string;
  code: number;

  constructor(v?: IError) {
    this.message = v?.message || "";
    this.code = v?.code || 0;
  }

  static encode(m: Error, w?: Writer): Writer {
    if (!w) w = new Writer();
    if (m.message.length) w.uint32(10).string(m.message);
    if (m.code) w.uint32(16).int32(m.code);
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): Error {
    r = r instanceof Reader ? r : new Reader(r);
    const end = length === undefined ? r.len : r.pos + length;
    const m = new Error();
    while (r.pos < end) {
      const tag = r.uint32();
      switch (tag >> 3) {
        case 1:
        m.message = r.string();
        break;
        case 2:
        m.code = r.int32();
        break;
        default:
        r.skipType(tag & 7);
        break;
      }
    }
    return m;
  }
}

export type ICancel = {
}

export class Cancel {

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function
  constructor(v?: ICancel) {
  }

  static encode(m: Cancel, w?: Writer): Writer {
    if (!w) w = new Writer();
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): Cancel {
    if (r instanceof Reader && length) r.skip(length);
    return new Cancel();
  }
}

export type IUndefined = {
}

export class Undefined {

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function
  constructor(v?: IUndefined) {
  }

  static encode(m: Undefined, w?: Writer): Writer {
    if (!w) w = new Writer();
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): Undefined {
    if (r instanceof Reader && length) r.skip(length);
    return new Undefined();
  }
}

export type IClose = {
}

export class Close {

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function
  constructor(v?: IClose) {
  }

  static encode(m: Close, w?: Writer): Writer {
    if (!w) w = new Writer();
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): Close {
    if (r instanceof Reader && length) r.skip(length);
    return new Close();
  }
}

