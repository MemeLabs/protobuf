import Reader from "@memelabs/protobuf/lib/pb/reader";
import Writer from "@memelabs/protobuf/lib/pb/writer";

import {
  Timestamp as google_protobuf_Timestamp,
  ITimestamp as google_protobuf_ITimestamp,
} from "../../../google/protobuf/timestamp";

export type ITickRequest = {
  times?: number;
}

export class TickRequest {
  times: number;

  constructor(v?: ITickRequest) {
    this.times = v?.times || 0;
  }

  static encode(m: TickRequest, w?: Writer): Writer {
    if (!w) w = new Writer();
    if (m.times) w.uint32(8).int32(m.times);
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): TickRequest {
    r = r instanceof Reader ? r : new Reader(r);
    const end = length === undefined ? r.len : r.pos + length;
    const m = new TickRequest();
    while (r.pos < end) {
      const tag = r.uint32();
      switch (tag >> 3) {
        case 1:
        m.times = r.int32();
        break;
        default:
        r.skipType(tag & 7);
        break;
      }
    }
    return m;
  }
}

export type ITickResponse = {
  index?: number;
  time?: google_protobuf_ITimestamp | undefined;
}

export class TickResponse {
  index: number;
  time: google_protobuf_Timestamp | undefined;

  constructor(v?: ITickResponse) {
    this.index = v?.index || 0;
    this.time = v?.time && new google_protobuf_Timestamp(v.time);
  }

  static encode(m: TickResponse, w?: Writer): Writer {
    if (!w) w = new Writer();
    if (m.index) w.uint32(8).int32(m.index);
    if (m.time) google_protobuf_Timestamp.encode(m.time, w.uint32(18).fork()).ldelim();
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): TickResponse {
    r = r instanceof Reader ? r : new Reader(r);
    const end = length === undefined ? r.len : r.pos + length;
    const m = new TickResponse();
    while (r.pos < end) {
      const tag = r.uint32();
      switch (tag >> 3) {
        case 1:
        m.index = r.int32();
        break;
        case 2:
        m.time = google_protobuf_Timestamp.decode(r, r.uint32());
        break;
        default:
        r.skipType(tag & 7);
        break;
      }
    }
    return m;
  }
}

