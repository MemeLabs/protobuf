import Reader from "../../../pb/reader";
import Writer from "../../../pb/writer";


export type IRPCCallUnaryRequest = {
  id?: bigint;
}

export class RPCCallUnaryRequest {
  id: bigint;

  constructor(v?: IRPCCallUnaryRequest) {
    this.id = v?.id || BigInt(0);
  }

  static encode(m: RPCCallUnaryRequest, w?: Writer): Writer {
    if (!w) w = new Writer();
    if (m.id) w.uint32(8).uint64(m.id);
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): RPCCallUnaryRequest {
    r = r instanceof Reader ? r : new Reader(r);
    const end = length === undefined ? r.len : r.pos + length;
    const m = new RPCCallUnaryRequest();
    while (r.pos < end) {
      const tag = r.uint32();
      switch (tag >> 3) {
        case 1:
        m.id = r.uint64();
        break;
        default:
        r.skipType(tag & 7);
        break;
      }
    }
    return m;
  }
}

export type IRPCCallUnaryResponse = {
  id?: bigint;
}

export class RPCCallUnaryResponse {
  id: bigint;

  constructor(v?: IRPCCallUnaryResponse) {
    this.id = v?.id || BigInt(0);
  }

  static encode(m: RPCCallUnaryResponse, w?: Writer): Writer {
    if (!w) w = new Writer();
    if (m.id) w.uint32(8).uint64(m.id);
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): RPCCallUnaryResponse {
    r = r instanceof Reader ? r : new Reader(r);
    const end = length === undefined ? r.len : r.pos + length;
    const m = new RPCCallUnaryResponse();
    while (r.pos < end) {
      const tag = r.uint32();
      switch (tag >> 3) {
        case 1:
        m.id = r.uint64();
        break;
        default:
        r.skipType(tag & 7);
        break;
      }
    }
    return m;
  }
}

export type IRPCCallStreamRequest = {
  id?: bigint;
  count?: bigint;
}

export class RPCCallStreamRequest {
  id: bigint;
  count: bigint;

  constructor(v?: IRPCCallStreamRequest) {
    this.id = v?.id || BigInt(0);
    this.count = v?.count || BigInt(0);
  }

  static encode(m: RPCCallStreamRequest, w?: Writer): Writer {
    if (!w) w = new Writer();
    if (m.id) w.uint32(8).uint64(m.id);
    if (m.count) w.uint32(16).uint64(m.count);
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): RPCCallStreamRequest {
    r = r instanceof Reader ? r : new Reader(r);
    const end = length === undefined ? r.len : r.pos + length;
    const m = new RPCCallStreamRequest();
    while (r.pos < end) {
      const tag = r.uint32();
      switch (tag >> 3) {
        case 1:
        m.id = r.uint64();
        break;
        case 2:
        m.count = r.uint64();
        break;
        default:
        r.skipType(tag & 7);
        break;
      }
    }
    return m;
  }
}

export type IRPCCallStreamResponse = {
  id?: bigint;
}

export class RPCCallStreamResponse {
  id: bigint;

  constructor(v?: IRPCCallStreamResponse) {
    this.id = v?.id || BigInt(0);
  }

  static encode(m: RPCCallStreamResponse, w?: Writer): Writer {
    if (!w) w = new Writer();
    if (m.id) w.uint32(8).uint64(m.id);
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): RPCCallStreamResponse {
    r = r instanceof Reader ? r : new Reader(r);
    const end = length === undefined ? r.len : r.pos + length;
    const m = new RPCCallStreamResponse();
    while (r.pos < end) {
      const tag = r.uint32();
      switch (tag >> 3) {
        case 1:
        m.id = r.uint64();
        break;
        default:
        r.skipType(tag & 7);
        break;
      }
    }
    return m;
  }
}

