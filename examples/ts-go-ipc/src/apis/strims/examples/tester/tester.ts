import Reader from "@memelabs/protobuf/lib/pb/reader";
import Writer from "@memelabs/protobuf/lib/pb/writer";


export type IUnaryRequest = {
  value?: bigint;
}

export class UnaryRequest {
  value: bigint;

  constructor(v?: IUnaryRequest) {
    this.value = v?.value || BigInt(0);
  }

  static encode(m: UnaryRequest, w?: Writer): Writer {
    if (!w) w = new Writer();
    if (m.value) w.uint32(8).int64(m.value);
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): UnaryRequest {
    r = r instanceof Reader ? r : new Reader(r);
    const end = length === undefined ? r.len : r.pos + length;
    const m = new UnaryRequest();
    while (r.pos < end) {
      const tag = r.uint32();
      switch (tag >> 3) {
        case 1:
        m.value = r.int64();
        break;
        default:
        r.skipType(tag & 7);
        break;
      }
    }
    return m;
  }
}

export type IUnaryResponse = {
  value?: bigint;
}

export class UnaryResponse {
  value: bigint;

  constructor(v?: IUnaryResponse) {
    this.value = v?.value || BigInt(0);
  }

  static encode(m: UnaryResponse, w?: Writer): Writer {
    if (!w) w = new Writer();
    if (m.value) w.uint32(8).int64(m.value);
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): UnaryResponse {
    r = r instanceof Reader ? r : new Reader(r);
    const end = length === undefined ? r.len : r.pos + length;
    const m = new UnaryResponse();
    while (r.pos < end) {
      const tag = r.uint32();
      switch (tag >> 3) {
        case 1:
        m.value = r.int64();
        break;
        default:
        r.skipType(tag & 7);
        break;
      }
    }
    return m;
  }
}

export type IStreamRequest = {
  value?: bigint;
}

export class StreamRequest {
  value: bigint;

  constructor(v?: IStreamRequest) {
    this.value = v?.value || BigInt(0);
  }

  static encode(m: StreamRequest, w?: Writer): Writer {
    if (!w) w = new Writer();
    if (m.value) w.uint32(8).int64(m.value);
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): StreamRequest {
    r = r instanceof Reader ? r : new Reader(r);
    const end = length === undefined ? r.len : r.pos + length;
    const m = new StreamRequest();
    while (r.pos < end) {
      const tag = r.uint32();
      switch (tag >> 3) {
        case 1:
        m.value = r.int64();
        break;
        default:
        r.skipType(tag & 7);
        break;
      }
    }
    return m;
  }
}

export type IStreamResponse = {
  value?: bigint;
}

export class StreamResponse {
  value: bigint;

  constructor(v?: IStreamResponse) {
    this.value = v?.value || BigInt(0);
  }

  static encode(m: StreamResponse, w?: Writer): Writer {
    if (!w) w = new Writer();
    if (m.value) w.uint32(8).int64(m.value);
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): StreamResponse {
    r = r instanceof Reader ? r : new Reader(r);
    const end = length === undefined ? r.len : r.pos + length;
    const m = new StreamResponse();
    while (r.pos < end) {
      const tag = r.uint32();
      switch (tag >> 3) {
        case 1:
        m.value = r.int64();
        break;
        default:
        r.skipType(tag & 7);
        break;
      }
    }
    return m;
  }
}

/* @internal */
export const strims_examples_tester_UnaryRequest = UnaryRequest;
/* @internal */
export type strims_examples_tester_UnaryRequest = UnaryRequest;
/* @internal */
export type strims_examples_tester_IUnaryRequest = IUnaryRequest;
/* @internal */
export const strims_examples_tester_UnaryResponse = UnaryResponse;
/* @internal */
export type strims_examples_tester_UnaryResponse = UnaryResponse;
/* @internal */
export type strims_examples_tester_IUnaryResponse = IUnaryResponse;
/* @internal */
export const strims_examples_tester_StreamRequest = StreamRequest;
/* @internal */
export type strims_examples_tester_StreamRequest = StreamRequest;
/* @internal */
export type strims_examples_tester_IStreamRequest = IStreamRequest;
/* @internal */
export const strims_examples_tester_StreamResponse = StreamResponse;
/* @internal */
export type strims_examples_tester_StreamResponse = StreamResponse;
/* @internal */
export type strims_examples_tester_IStreamResponse = IStreamResponse;
