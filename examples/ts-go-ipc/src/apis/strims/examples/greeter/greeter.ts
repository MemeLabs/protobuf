import Reader from "@memelabs/protobuf/lib/pb/reader";
import Writer from "@memelabs/protobuf/lib/pb/writer";


export type IGreetRequest = {
  name?: string;
}

export class GreetRequest {
  name: string;

  constructor(v?: IGreetRequest) {
    this.name = v?.name || "";
  }

  static encode(m: GreetRequest, w?: Writer): Writer {
    if (!w) w = new Writer();
    if (m.name.length) w.uint32(10).string(m.name);
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): GreetRequest {
    r = r instanceof Reader ? r : new Reader(r);
    const end = length === undefined ? r.len : r.pos + length;
    const m = new GreetRequest();
    while (r.pos < end) {
      const tag = r.uint32();
      switch (tag >> 3) {
        case 1:
        m.name = r.string();
        break;
        default:
        r.skipType(tag & 7);
        break;
      }
    }
    return m;
  }
}

export type IGreetResponse = {
  greeting?: string;
}

export class GreetResponse {
  greeting: string;

  constructor(v?: IGreetResponse) {
    this.greeting = v?.greeting || "";
  }

  static encode(m: GreetResponse, w?: Writer): Writer {
    if (!w) w = new Writer();
    if (m.greeting.length) w.uint32(10).string(m.greeting);
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): GreetResponse {
    r = r instanceof Reader ? r : new Reader(r);
    const end = length === undefined ? r.len : r.pos + length;
    const m = new GreetResponse();
    while (r.pos < end) {
      const tag = r.uint32();
      switch (tag >> 3) {
        case 1:
        m.greeting = r.string();
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
export const strims_examples_greeter_GreetRequest = GreetRequest;
/* @internal */
export type strims_examples_greeter_GreetRequest = GreetRequest;
/* @internal */
export type strims_examples_greeter_IGreetRequest = IGreetRequest;
/* @internal */
export const strims_examples_greeter_GreetResponse = GreetResponse;
/* @internal */
export type strims_examples_greeter_GreetResponse = GreetResponse;
/* @internal */
export type strims_examples_greeter_IGreetResponse = IGreetResponse;
