import Reader from "../../../pb/reader";
import Writer from "../../../pb/writer";


export type ITestMessage = {
  int32Value?: number;
  int64Value?: bigint;
  uint32Value?: number;
  uint64Value?: bigint;
  sint32Value?: number;
  sint64Value?: bigint;
  boolValue?: boolean;
  enumValue?: TestMessage.TestEnum;
  fixed64Value?: bigint;
  sfixed64Value?: bigint;
  doubleValue?: number;
  stringValue?: string;
  bytesValue?: Uint8Array;
  fixed32Value?: number;
  sfixedValue?: number;
  floatValue?: number;
}

export class TestMessage {
  int32Value: number;
  int64Value: bigint;
  uint32Value: number;
  uint64Value: bigint;
  sint32Value: number;
  sint64Value: bigint;
  boolValue: boolean;
  enumValue: TestMessage.TestEnum;
  fixed64Value: bigint;
  sfixed64Value: bigint;
  doubleValue: number;
  stringValue: string;
  bytesValue: Uint8Array;
  fixed32Value: number;
  sfixedValue: number;
  floatValue: number;

  constructor(v?: ITestMessage) {
    this.int32Value = v?.int32Value || 0;
    this.int64Value = v?.int64Value || BigInt(0);
    this.uint32Value = v?.uint32Value || 0;
    this.uint64Value = v?.uint64Value || BigInt(0);
    this.sint32Value = v?.sint32Value || 0;
    this.sint64Value = v?.sint64Value || BigInt(0);
    this.boolValue = v?.boolValue || false;
    this.enumValue = v?.enumValue || 0;
    this.fixed64Value = v?.fixed64Value || BigInt(0);
    this.sfixed64Value = v?.sfixed64Value || BigInt(0);
    this.doubleValue = v?.doubleValue || 0;
    this.stringValue = v?.stringValue || "";
    this.bytesValue = v?.bytesValue || new Uint8Array();
    this.fixed32Value = v?.fixed32Value || 0;
    this.sfixedValue = v?.sfixedValue || 0;
    this.floatValue = v?.floatValue || 0;
  }

  static encode(m: TestMessage, w?: Writer): Writer {
    if (!w) w = new Writer();
    if (m.int32Value) w.uint32(8).int32(m.int32Value);
    if (m.int64Value) w.uint32(16).int64(m.int64Value);
    if (m.uint32Value) w.uint32(24).uint32(m.uint32Value);
    if (m.uint64Value) w.uint32(32).uint64(m.uint64Value);
    if (m.sint32Value) w.uint32(40).sint32(m.sint32Value);
    if (m.sint64Value) w.uint32(48).sint64(m.sint64Value);
    if (m.boolValue) w.uint32(56).bool(m.boolValue);
    if (m.enumValue) w.uint32(64).uint32(m.enumValue);
    if (m.fixed64Value) w.uint32(73).sfixed64(m.fixed64Value);
    if (m.sfixed64Value) w.uint32(81).sfixed64(m.sfixed64Value);
    if (m.doubleValue) w.uint32(89).double(m.doubleValue);
    if (m.stringValue) w.uint32(98).string(m.stringValue);
    if (m.bytesValue) w.uint32(106).bytes(m.bytesValue);
    if (m.fixed32Value) w.uint32(117).fixed32(m.fixed32Value);
    if (m.sfixedValue) w.uint32(125).sfixed32(m.sfixedValue);
    if (m.floatValue) w.uint32(133).float(m.floatValue);
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): TestMessage {
    r = r instanceof Reader ? r : new Reader(r);
    const end = length === undefined ? r.len : r.pos + length;
    const m = new TestMessage();
    while (r.pos < end) {
      const tag = r.uint32();
      switch (tag >> 3) {
        case 1:
        m.int32Value = r.int32();
        break;
        case 2:
        m.int64Value = r.int64();
        break;
        case 3:
        m.uint32Value = r.uint32();
        break;
        case 4:
        m.uint64Value = r.uint64();
        break;
        case 5:
        m.sint32Value = r.sint32();
        break;
        case 6:
        m.sint64Value = r.sint64();
        break;
        case 7:
        m.boolValue = r.bool();
        break;
        case 8:
        m.enumValue = r.uint32();
        break;
        case 9:
        m.fixed64Value = r.sfixed64();
        break;
        case 10:
        m.sfixed64Value = r.sfixed64();
        break;
        case 11:
        m.doubleValue = r.double();
        break;
        case 12:
        m.stringValue = r.string();
        break;
        case 13:
        m.bytesValue = r.bytes();
        break;
        case 14:
        m.fixed32Value = r.fixed32();
        break;
        case 15:
        m.sfixedValue = r.sfixed32();
        break;
        case 16:
        m.floatValue = r.float();
        break;
        default:
        r.skipType(tag & 7);
        break;
      }
    }
    return m;
  }
}

export namespace TestMessage {
  export enum TestEnum {
    TEST_ENUM_VAL_0 = 0,
    TEST_ENUM_VAL_1 = 1,
    TEST_ENUM_VAL_2 = 2,
  }
}

