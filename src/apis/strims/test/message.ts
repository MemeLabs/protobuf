import Reader from "../../../pb/reader";
import Writer from "../../../pb/writer";

import {
  strims_test_internal_Bar_Foo_Bar,
  strims_test_internal_Bar_Foo_IBar,
  strims_test_internal_Foo,
  strims_test_internal_IFoo,
  strims_test_internal_Bar_Foo,
  strims_test_internal_Bar_IFoo,
} from "./internal/internal";

export type ITestMessage = {
  int32Value?: number;
  int64Value?: bigint;
  uint32Value?: number;
  uint64Value?: bigint;
  sint32Value?: number;
  sint64Value?: bigint;
  boolValue?: boolean;
  enumValue?: strims_test_TestMessage_TestEnum;
  fixed64Value?: bigint;
  sfixed64Value?: bigint;
  doubleValue?: number;
  stringValue?: string;
  bytesValue?: Uint8Array;
  fixed32Value?: number;
  sfixedValue?: number;
  floatValue?: number;
  embeddedMessageValue?: strims_test_TestMessage_IEmbeddedMessage;
  siblingMessageValue?: strims_test_ISiblingMessage;
  stringInt32MapValue?: Map<string, number> | { [key: string]: number };
  stringInt64MapValue?: Map<string, bigint> | { [key: string]: bigint };
  stringStringMapValue?: Map<string, string> | { [key: string]: string };
  stringEmbeddedMessageMapValue?: Map<string, strims_test_TestMessage_IEmbeddedMessage> | { [key: string]: strims_test_TestMessage_IEmbeddedMessage };
  int32Int32MapValue?: Map<number, number> | { [key: number]: number };
  int32Int64MapValue?: Map<number, bigint> | { [key: number]: bigint };
  int32StringMapValue?: Map<number, string> | { [key: number]: string };
  int32EmbeddedMessageMapValue?: Map<number, strims_test_TestMessage_IEmbeddedMessage> | { [key: number]: strims_test_TestMessage_IEmbeddedMessage };
  int64Int32MapValue?: Map<bigint, number>;
  int64Int64MapValue?: Map<bigint, bigint>;
  int64StringMapValue?: Map<bigint, string>;
  int64EmbeddedMessageMapValue?: Map<bigint, strims_test_TestMessage_EmbeddedMessage>;
  repeatedInt32MapValue?: number[];
  repeatedInt64MapValue?: bigint[];
  repeatedStringMapValue?: string[];
  repeatedEmbeddedMessageMapValue?: strims_test_TestMessage_IEmbeddedMessage[];
}

export class TestMessage {
  int32Value: number;
  int64Value: bigint;
  uint32Value: number;
  uint64Value: bigint;
  sint32Value: number;
  sint64Value: bigint;
  boolValue: boolean;
  enumValue: strims_test_TestMessage_TestEnum;
  fixed64Value: bigint;
  sfixed64Value: bigint;
  doubleValue: number;
  stringValue: string;
  bytesValue: Uint8Array;
  fixed32Value: number;
  sfixedValue: number;
  floatValue: number;
  embeddedMessageValue: strims_test_TestMessage_EmbeddedMessage | undefined;
  siblingMessageValue: strims_test_SiblingMessage | undefined;
  stringInt32MapValue: Map<string, number>;
  stringInt64MapValue: Map<string, bigint>;
  stringStringMapValue: Map<string, string>;
  stringEmbeddedMessageMapValue: Map<string, strims_test_TestMessage_EmbeddedMessage>;
  int32Int32MapValue: Map<number, number>;
  int32Int64MapValue: Map<number, bigint>;
  int32StringMapValue: Map<number, string>;
  int32EmbeddedMessageMapValue: Map<number, strims_test_TestMessage_EmbeddedMessage>;
  int64Int32MapValue: Map<bigint, number>;
  int64Int64MapValue: Map<bigint, bigint>;
  int64StringMapValue: Map<bigint, string>;
  int64EmbeddedMessageMapValue: Map<bigint, strims_test_TestMessage_EmbeddedMessage>;
  repeatedInt32MapValue: number[];
  repeatedInt64MapValue: bigint[];
  repeatedStringMapValue: string[];
  repeatedEmbeddedMessageMapValue: strims_test_TestMessage_EmbeddedMessage[];

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
    this.embeddedMessageValue = v?.embeddedMessageValue && new strims_test_TestMessage_EmbeddedMessage(v.embeddedMessageValue);
    this.siblingMessageValue = v?.siblingMessageValue && new strims_test_SiblingMessage(v.siblingMessageValue);
    if (v?.stringInt32MapValue) this.stringInt32MapValue = new Map(v.stringInt32MapValue instanceof Map ? v.stringInt32MapValue : Object.entries(v.stringInt32MapValue).map(([k, v]) => [String(k), v]));
    else this.stringInt32MapValue = new Map<string, number>();
    if (v?.stringInt64MapValue) this.stringInt64MapValue = new Map(v.stringInt64MapValue instanceof Map ? v.stringInt64MapValue : Object.entries(v.stringInt64MapValue).map(([k, v]) => [String(k), v]));
    else this.stringInt64MapValue = new Map<string, bigint>();
    if (v?.stringStringMapValue) this.stringStringMapValue = new Map(v.stringStringMapValue instanceof Map ? v.stringStringMapValue : Object.entries(v.stringStringMapValue).map(([k, v]) => [String(k), v]));
    else this.stringStringMapValue = new Map<string, string>();
    if (v?.stringEmbeddedMessageMapValue) this.stringEmbeddedMessageMapValue = new Map(v.stringEmbeddedMessageMapValue instanceof Map ? Array.from(v.stringEmbeddedMessageMapValue).map(([k, v]) => [k, new strims_test_TestMessage_EmbeddedMessage(v)]) : Object.entries(v.stringEmbeddedMessageMapValue).map(([k, v]) => [String(k), new strims_test_TestMessage_EmbeddedMessage(v)]));
    else this.stringEmbeddedMessageMapValue = new Map<string, strims_test_TestMessage_EmbeddedMessage>();
    if (v?.int32Int32MapValue) this.int32Int32MapValue = new Map(v.int32Int32MapValue instanceof Map ? v.int32Int32MapValue : Object.entries(v.int32Int32MapValue).map(([k, v]) => [Number(k), v]));
    else this.int32Int32MapValue = new Map<number, number>();
    if (v?.int32Int64MapValue) this.int32Int64MapValue = new Map(v.int32Int64MapValue instanceof Map ? v.int32Int64MapValue : Object.entries(v.int32Int64MapValue).map(([k, v]) => [Number(k), v]));
    else this.int32Int64MapValue = new Map<number, bigint>();
    if (v?.int32StringMapValue) this.int32StringMapValue = new Map(v.int32StringMapValue instanceof Map ? v.int32StringMapValue : Object.entries(v.int32StringMapValue).map(([k, v]) => [Number(k), v]));
    else this.int32StringMapValue = new Map<number, string>();
    if (v?.int32EmbeddedMessageMapValue) this.int32EmbeddedMessageMapValue = new Map(v.int32EmbeddedMessageMapValue instanceof Map ? Array.from(v.int32EmbeddedMessageMapValue).map(([k, v]) => [k, new strims_test_TestMessage_EmbeddedMessage(v)]) : Object.entries(v.int32EmbeddedMessageMapValue).map(([k, v]) => [Number(k), new strims_test_TestMessage_EmbeddedMessage(v)]));
    else this.int32EmbeddedMessageMapValue = new Map<number, strims_test_TestMessage_EmbeddedMessage>();
    if (v?.int64Int32MapValue) this.int64Int32MapValue = new Map(v.int64Int32MapValue);
    else this.int64Int32MapValue = new Map<bigint, number>();
    if (v?.int64Int64MapValue) this.int64Int64MapValue = new Map(v.int64Int64MapValue);
    else this.int64Int64MapValue = new Map<bigint, bigint>();
    if (v?.int64StringMapValue) this.int64StringMapValue = new Map(v.int64StringMapValue);
    else this.int64StringMapValue = new Map<bigint, string>();
    if (v?.int64EmbeddedMessageMapValue) this.int64EmbeddedMessageMapValue = new Map(Array.from(v.int64EmbeddedMessageMapValue).map(([k, v]) => [k, new strims_test_TestMessage_EmbeddedMessage(v)]));
    else this.int64EmbeddedMessageMapValue = new Map<bigint, strims_test_TestMessage_EmbeddedMessage>();
    this.repeatedInt32MapValue = v?.repeatedInt32MapValue ? v.repeatedInt32MapValue : [];
    this.repeatedInt64MapValue = v?.repeatedInt64MapValue ? v.repeatedInt64MapValue : [];
    this.repeatedStringMapValue = v?.repeatedStringMapValue ? v.repeatedStringMapValue : [];
    this.repeatedEmbeddedMessageMapValue = v?.repeatedEmbeddedMessageMapValue ? v.repeatedEmbeddedMessageMapValue.map(v => new strims_test_TestMessage_EmbeddedMessage(v)) : [];
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
    if (m.stringValue.length) w.uint32(98).string(m.stringValue);
    if (m.bytesValue.length) w.uint32(106).bytes(m.bytesValue);
    if (m.fixed32Value) w.uint32(117).fixed32(m.fixed32Value);
    if (m.sfixedValue) w.uint32(125).sfixed32(m.sfixedValue);
    if (m.floatValue) w.uint32(133).float(m.floatValue);
    if (m.embeddedMessageValue) strims_test_TestMessage_EmbeddedMessage.encode(m.embeddedMessageValue, w.uint32(138).fork()).ldelim();
    if (m.siblingMessageValue) strims_test_SiblingMessage.encode(m.siblingMessageValue, w.uint32(146).fork()).ldelim();
    for (const [k, v] of m.stringInt32MapValue) w.uint32(154).fork().uint32(10).string(k).uint32(18).int32(v).ldelim();
    for (const [k, v] of m.stringInt64MapValue) w.uint32(162).fork().uint32(10).string(k).uint32(18).int64(v).ldelim();
    for (const [k, v] of m.stringStringMapValue) w.uint32(170).fork().uint32(10).string(k).uint32(18).string(v).ldelim();
    for (const [k, v] of m.stringEmbeddedMessageMapValue) strims_test_TestMessage_EmbeddedMessage.encode(v, w.uint32(178).fork().uint32(10).string(k).uint32(18).fork()).ldelim().ldelim();
    for (const [k, v] of m.int32Int32MapValue) w.uint32(186).fork().uint32(8).int32(k).uint32(18).int32(v).ldelim();
    for (const [k, v] of m.int32Int64MapValue) w.uint32(194).fork().uint32(8).int32(k).uint32(18).int64(v).ldelim();
    for (const [k, v] of m.int32StringMapValue) w.uint32(202).fork().uint32(8).int32(k).uint32(18).string(v).ldelim();
    for (const [k, v] of m.int32EmbeddedMessageMapValue) strims_test_TestMessage_EmbeddedMessage.encode(v, w.uint32(210).fork().uint32(8).int32(k).uint32(18).fork()).ldelim().ldelim();
    for (const [k, v] of m.int64Int32MapValue) w.uint32(218).fork().uint32(8).int64(k).uint32(18).int32(v).ldelim();
    for (const [k, v] of m.int64Int64MapValue) w.uint32(226).fork().uint32(8).int64(k).uint32(18).int64(v).ldelim();
    for (const [k, v] of m.int64StringMapValue) w.uint32(234).fork().uint32(8).int64(k).uint32(18).string(v).ldelim();
    for (const [k, v] of m.int64EmbeddedMessageMapValue) strims_test_TestMessage_EmbeddedMessage.encode(v, w.uint32(242).fork().uint32(8).int64(k).uint32(18).fork()).ldelim().ldelim();
    m.repeatedInt32MapValue.reduce((w, v) => w.int32(v), w.uint32(250).fork()).ldelim();
    m.repeatedInt64MapValue.reduce((w, v) => w.int64(v), w.uint32(258).fork()).ldelim();
    for (const v of m.repeatedStringMapValue) w.uint32(266).string(v);
    for (const v of m.repeatedEmbeddedMessageMapValue) strims_test_TestMessage_EmbeddedMessage.encode(v, w.uint32(274).fork()).ldelim();
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
        case 17:
        m.embeddedMessageValue = strims_test_TestMessage_EmbeddedMessage.decode(r, r.uint32());
        break;
        case 18:
        m.siblingMessageValue = strims_test_SiblingMessage.decode(r, r.uint32());
        break;
        case 19:
        {
          const flen = r.uint32();
          const fend = r.pos + flen;
          let key: string;
          let value: number;
          while (r.pos < fend) {
            const ftag = r.uint32();
            switch (ftag >> 3) {
              case 1:
              key = r.string()
              break;
              case 2:
              value = r.int32();
              break;
            }
          }
          m.stringInt32MapValue.set(key, value)
        }
        break;
        case 20:
        {
          const flen = r.uint32();
          const fend = r.pos + flen;
          let key: string;
          let value: bigint;
          while (r.pos < fend) {
            const ftag = r.uint32();
            switch (ftag >> 3) {
              case 1:
              key = r.string()
              break;
              case 2:
              value = r.int64();
              break;
            }
          }
          m.stringInt64MapValue.set(key, value)
        }
        break;
        case 21:
        {
          const flen = r.uint32();
          const fend = r.pos + flen;
          let key: string;
          let value: string;
          while (r.pos < fend) {
            const ftag = r.uint32();
            switch (ftag >> 3) {
              case 1:
              key = r.string()
              break;
              case 2:
              value = r.string();
              break;
            }
          }
          m.stringStringMapValue.set(key, value)
        }
        break;
        case 22:
        {
          const flen = r.uint32();
          const fend = r.pos + flen;
          let key: string;
          let value: strims_test_TestMessage_EmbeddedMessage;
          while (r.pos < fend) {
            const ftag = r.uint32();
            switch (ftag >> 3) {
              case 1:
              key = r.string()
              break;
              case 2:
              value = strims_test_TestMessage_EmbeddedMessage.decode(r, r.uint32());
              break;
            }
          }
          m.stringEmbeddedMessageMapValue.set(key, value)
        }
        break;
        case 23:
        {
          const flen = r.uint32();
          const fend = r.pos + flen;
          let key: number;
          let value: number;
          while (r.pos < fend) {
            const ftag = r.uint32();
            switch (ftag >> 3) {
              case 1:
              key = r.int32()
              break;
              case 2:
              value = r.int32();
              break;
            }
          }
          m.int32Int32MapValue.set(key, value)
        }
        break;
        case 24:
        {
          const flen = r.uint32();
          const fend = r.pos + flen;
          let key: number;
          let value: bigint;
          while (r.pos < fend) {
            const ftag = r.uint32();
            switch (ftag >> 3) {
              case 1:
              key = r.int32()
              break;
              case 2:
              value = r.int64();
              break;
            }
          }
          m.int32Int64MapValue.set(key, value)
        }
        break;
        case 25:
        {
          const flen = r.uint32();
          const fend = r.pos + flen;
          let key: number;
          let value: string;
          while (r.pos < fend) {
            const ftag = r.uint32();
            switch (ftag >> 3) {
              case 1:
              key = r.int32()
              break;
              case 2:
              value = r.string();
              break;
            }
          }
          m.int32StringMapValue.set(key, value)
        }
        break;
        case 26:
        {
          const flen = r.uint32();
          const fend = r.pos + flen;
          let key: number;
          let value: strims_test_TestMessage_EmbeddedMessage;
          while (r.pos < fend) {
            const ftag = r.uint32();
            switch (ftag >> 3) {
              case 1:
              key = r.int32()
              break;
              case 2:
              value = strims_test_TestMessage_EmbeddedMessage.decode(r, r.uint32());
              break;
            }
          }
          m.int32EmbeddedMessageMapValue.set(key, value)
        }
        break;
        case 27:
        {
          const flen = r.uint32();
          const fend = r.pos + flen;
          let key: bigint;
          let value: number;
          while (r.pos < fend) {
            const ftag = r.uint32();
            switch (ftag >> 3) {
              case 1:
              key = r.int64()
              break;
              case 2:
              value = r.int32();
              break;
            }
          }
          m.int64Int32MapValue.set(key, value)
        }
        break;
        case 28:
        {
          const flen = r.uint32();
          const fend = r.pos + flen;
          let key: bigint;
          let value: bigint;
          while (r.pos < fend) {
            const ftag = r.uint32();
            switch (ftag >> 3) {
              case 1:
              key = r.int64()
              break;
              case 2:
              value = r.int64();
              break;
            }
          }
          m.int64Int64MapValue.set(key, value)
        }
        break;
        case 29:
        {
          const flen = r.uint32();
          const fend = r.pos + flen;
          let key: bigint;
          let value: string;
          while (r.pos < fend) {
            const ftag = r.uint32();
            switch (ftag >> 3) {
              case 1:
              key = r.int64()
              break;
              case 2:
              value = r.string();
              break;
            }
          }
          m.int64StringMapValue.set(key, value)
        }
        break;
        case 30:
        {
          const flen = r.uint32();
          const fend = r.pos + flen;
          let key: bigint;
          let value: strims_test_TestMessage_EmbeddedMessage;
          while (r.pos < fend) {
            const ftag = r.uint32();
            switch (ftag >> 3) {
              case 1:
              key = r.int64()
              break;
              case 2:
              value = strims_test_TestMessage_EmbeddedMessage.decode(r, r.uint32());
              break;
            }
          }
          m.int64EmbeddedMessageMapValue.set(key, value)
        }
        break;
        case 31:
        for (const flen = r.uint32(), fend = r.pos + flen; r.pos < fend;) m.repeatedInt32MapValue.push(r.int32());
        break;
        case 32:
        for (const flen = r.uint32(), fend = r.pos + flen; r.pos < fend;) m.repeatedInt64MapValue.push(r.int64());
        break;
        case 33:
        m.repeatedStringMapValue.push(r.string())
        break;
        case 34:
        m.repeatedEmbeddedMessageMapValue.push(strims_test_TestMessage_EmbeddedMessage.decode(r, r.uint32()));
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
  export type IEmbeddedMessage = {
    embeddedValue?: number;
  }

  export class EmbeddedMessage {
    embeddedValue: number;

    constructor(v?: IEmbeddedMessage) {
      this.embeddedValue = v?.embeddedValue || 0;
    }

    static encode(m: EmbeddedMessage, w?: Writer): Writer {
      if (!w) w = new Writer();
      if (m.embeddedValue) w.uint32(8).int32(m.embeddedValue);
      return w;
    }

    static decode(r: Reader | Uint8Array, length?: number): EmbeddedMessage {
      r = r instanceof Reader ? r : new Reader(r);
      const end = length === undefined ? r.len : r.pos + length;
      const m = new EmbeddedMessage();
      while (r.pos < end) {
        const tag = r.uint32();
        switch (tag >> 3) {
          case 1:
          m.embeddedValue = r.int32();
          break;
          default:
          r.skipType(tag & 7);
          break;
        }
      }
      return m;
    }
  }

  export enum TestEnum {
    TEST_ENUM_VAL_0 = 0,
    TEST_ENUM_VAL_1 = 1,
    TEST_ENUM_VAL_2 = 2,
  }
}

export type ISiblingMessage = Record<string, any>;

export class SiblingMessage {

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function
  constructor(v?: ISiblingMessage) {
  }

  static encode(m: SiblingMessage, w?: Writer): Writer {
    if (!w) w = new Writer();
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): SiblingMessage {
    if (r instanceof Reader && length) r.skip(length);
    return new SiblingMessage();
  }
}

export type IFoo = Record<string, any>;

export class Foo {

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function
  constructor(v?: IFoo) {
  }

  static encode(m: Foo, w?: Writer): Writer {
    if (!w) w = new Writer();
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): Foo {
    if (r instanceof Reader && length) r.skip(length);
    return new Foo();
  }
}

export type IBar = {
  testFoo?: strims_test_IFoo;
  testBarFoo?: strims_test_Bar_IFoo;
  testInternalFoo?: strims_test_internal_IFoo;
}

export class Bar {
  testFoo: strims_test_Foo | undefined;
  testBarFoo: strims_test_Bar_Foo | undefined;
  testInternalFoo: strims_test_internal_Foo | undefined;

  constructor(v?: IBar) {
    this.testFoo = v?.testFoo && new strims_test_Foo(v.testFoo);
    this.testBarFoo = v?.testBarFoo && new strims_test_Bar_Foo(v.testBarFoo);
    this.testInternalFoo = v?.testInternalFoo && new strims_test_internal_Foo(v.testInternalFoo);
  }

  static encode(m: Bar, w?: Writer): Writer {
    if (!w) w = new Writer();
    if (m.testFoo) strims_test_Foo.encode(m.testFoo, w.uint32(10).fork()).ldelim();
    if (m.testBarFoo) strims_test_Bar_Foo.encode(m.testBarFoo, w.uint32(18).fork()).ldelim();
    if (m.testInternalFoo) strims_test_internal_Foo.encode(m.testInternalFoo, w.uint32(26).fork()).ldelim();
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): Bar {
    r = r instanceof Reader ? r : new Reader(r);
    const end = length === undefined ? r.len : r.pos + length;
    const m = new Bar();
    while (r.pos < end) {
      const tag = r.uint32();
      switch (tag >> 3) {
        case 1:
        m.testFoo = strims_test_Foo.decode(r, r.uint32());
        break;
        case 2:
        m.testBarFoo = strims_test_Bar_Foo.decode(r, r.uint32());
        break;
        case 3:
        m.testInternalFoo = strims_test_internal_Foo.decode(r, r.uint32());
        break;
        default:
        r.skipType(tag & 7);
        break;
      }
    }
    return m;
  }
}

export namespace Bar {
  export type IFoo = {
    testFoo?: strims_test_IFoo;
    testBarFoo?: strims_test_Bar_IFoo;
    testInternalFoo?: strims_test_internal_IFoo;
  }

  export class Foo {
    testFoo: strims_test_Foo | undefined;
    testBarFoo: strims_test_Bar_Foo | undefined;
    testInternalFoo: strims_test_internal_Foo | undefined;

    constructor(v?: IFoo) {
      this.testFoo = v?.testFoo && new strims_test_Foo(v.testFoo);
      this.testBarFoo = v?.testBarFoo && new strims_test_Bar_Foo(v.testBarFoo);
      this.testInternalFoo = v?.testInternalFoo && new strims_test_internal_Foo(v.testInternalFoo);
    }

    static encode(m: Foo, w?: Writer): Writer {
      if (!w) w = new Writer();
      if (m.testFoo) strims_test_Foo.encode(m.testFoo, w.uint32(10).fork()).ldelim();
      if (m.testBarFoo) strims_test_Bar_Foo.encode(m.testBarFoo, w.uint32(18).fork()).ldelim();
      if (m.testInternalFoo) strims_test_internal_Foo.encode(m.testInternalFoo, w.uint32(26).fork()).ldelim();
      return w;
    }

    static decode(r: Reader | Uint8Array, length?: number): Foo {
      r = r instanceof Reader ? r : new Reader(r);
      const end = length === undefined ? r.len : r.pos + length;
      const m = new Foo();
      while (r.pos < end) {
        const tag = r.uint32();
        switch (tag >> 3) {
          case 1:
          m.testFoo = strims_test_Foo.decode(r, r.uint32());
          break;
          case 2:
          m.testBarFoo = strims_test_Bar_Foo.decode(r, r.uint32());
          break;
          case 3:
          m.testInternalFoo = strims_test_internal_Foo.decode(r, r.uint32());
          break;
          default:
          r.skipType(tag & 7);
          break;
        }
      }
      return m;
    }
  }

  export namespace Foo {
    export type IBar = {
      testFoo?: strims_test_IFoo;
      testBarFoo?: strims_test_Bar_IFoo;
      testBarFoo2?: strims_test_Bar_IFoo;
      testBarFooBar?: strims_test_Bar_Foo_IBar;
      testBarFooBar2?: strims_test_Bar_Foo_IBar;
      testInternalFoo?: strims_test_internal_IFoo;
      testInternalBarFoo?: strims_test_internal_Bar_IFoo;
      testInternalBarFooBar?: strims_test_internal_Bar_Foo_IBar;
    }

    export class Bar {
      testFoo: strims_test_Foo | undefined;
      testBarFoo: strims_test_Bar_Foo | undefined;
      testBarFoo2: strims_test_Bar_Foo | undefined;
      testBarFooBar: strims_test_Bar_Foo_Bar | undefined;
      testBarFooBar2: strims_test_Bar_Foo_Bar | undefined;
      testInternalFoo: strims_test_internal_Foo | undefined;
      testInternalBarFoo: strims_test_internal_Bar_Foo | undefined;
      testInternalBarFooBar: strims_test_internal_Bar_Foo_Bar | undefined;

      constructor(v?: IBar) {
        this.testFoo = v?.testFoo && new strims_test_Foo(v.testFoo);
        this.testBarFoo = v?.testBarFoo && new strims_test_Bar_Foo(v.testBarFoo);
        this.testBarFoo2 = v?.testBarFoo2 && new strims_test_Bar_Foo(v.testBarFoo2);
        this.testBarFooBar = v?.testBarFooBar && new strims_test_Bar_Foo_Bar(v.testBarFooBar);
        this.testBarFooBar2 = v?.testBarFooBar2 && new strims_test_Bar_Foo_Bar(v.testBarFooBar2);
        this.testInternalFoo = v?.testInternalFoo && new strims_test_internal_Foo(v.testInternalFoo);
        this.testInternalBarFoo = v?.testInternalBarFoo && new strims_test_internal_Bar_Foo(v.testInternalBarFoo);
        this.testInternalBarFooBar = v?.testInternalBarFooBar && new strims_test_internal_Bar_Foo_Bar(v.testInternalBarFooBar);
      }

      static encode(m: Bar, w?: Writer): Writer {
        if (!w) w = new Writer();
        if (m.testFoo) strims_test_Foo.encode(m.testFoo, w.uint32(10).fork()).ldelim();
        if (m.testBarFoo) strims_test_Bar_Foo.encode(m.testBarFoo, w.uint32(18).fork()).ldelim();
        if (m.testBarFoo2) strims_test_Bar_Foo.encode(m.testBarFoo2, w.uint32(26).fork()).ldelim();
        if (m.testBarFooBar) strims_test_Bar_Foo_Bar.encode(m.testBarFooBar, w.uint32(34).fork()).ldelim();
        if (m.testBarFooBar2) strims_test_Bar_Foo_Bar.encode(m.testBarFooBar2, w.uint32(42).fork()).ldelim();
        if (m.testInternalFoo) strims_test_internal_Foo.encode(m.testInternalFoo, w.uint32(50).fork()).ldelim();
        if (m.testInternalBarFoo) strims_test_internal_Bar_Foo.encode(m.testInternalBarFoo, w.uint32(58).fork()).ldelim();
        if (m.testInternalBarFooBar) strims_test_internal_Bar_Foo_Bar.encode(m.testInternalBarFooBar, w.uint32(66).fork()).ldelim();
        return w;
      }

      static decode(r: Reader | Uint8Array, length?: number): Bar {
        r = r instanceof Reader ? r : new Reader(r);
        const end = length === undefined ? r.len : r.pos + length;
        const m = new Bar();
        while (r.pos < end) {
          const tag = r.uint32();
          switch (tag >> 3) {
            case 1:
            m.testFoo = strims_test_Foo.decode(r, r.uint32());
            break;
            case 2:
            m.testBarFoo = strims_test_Bar_Foo.decode(r, r.uint32());
            break;
            case 3:
            m.testBarFoo2 = strims_test_Bar_Foo.decode(r, r.uint32());
            break;
            case 4:
            m.testBarFooBar = strims_test_Bar_Foo_Bar.decode(r, r.uint32());
            break;
            case 5:
            m.testBarFooBar2 = strims_test_Bar_Foo_Bar.decode(r, r.uint32());
            break;
            case 6:
            m.testInternalFoo = strims_test_internal_Foo.decode(r, r.uint32());
            break;
            case 7:
            m.testInternalBarFoo = strims_test_internal_Bar_Foo.decode(r, r.uint32());
            break;
            case 8:
            m.testInternalBarFooBar = strims_test_internal_Bar_Foo_Bar.decode(r, r.uint32());
            break;
            default:
            r.skipType(tag & 7);
            break;
          }
        }
        return m;
      }
    }

  }

}

/* @internal */
export const strims_test_TestMessage = TestMessage;
/* @internal */
export type strims_test_TestMessage = TestMessage;
/* @internal */
export type strims_test_ITestMessage = ITestMessage;
/* @internal */
export const strims_test_SiblingMessage = SiblingMessage;
/* @internal */
export type strims_test_SiblingMessage = SiblingMessage;
/* @internal */
export type strims_test_ISiblingMessage = ISiblingMessage;
/* @internal */
export const strims_test_Foo = Foo;
/* @internal */
export type strims_test_Foo = Foo;
/* @internal */
export type strims_test_IFoo = IFoo;
/* @internal */
export const strims_test_Bar = Bar;
/* @internal */
export type strims_test_Bar = Bar;
/* @internal */
export type strims_test_IBar = IBar;
/* @internal */
export const strims_test_TestMessage_EmbeddedMessage = TestMessage.EmbeddedMessage;
/* @internal */
export type strims_test_TestMessage_EmbeddedMessage = TestMessage.EmbeddedMessage;
/* @internal */
export type strims_test_TestMessage_IEmbeddedMessage = TestMessage.IEmbeddedMessage;
/* @internal */
export const strims_test_Bar_Foo = Bar.Foo;
/* @internal */
export type strims_test_Bar_Foo = Bar.Foo;
/* @internal */
export type strims_test_Bar_IFoo = Bar.IFoo;
/* @internal */
export const strims_test_Bar_Foo_Bar = Bar.Foo.Bar;
/* @internal */
export type strims_test_Bar_Foo_Bar = Bar.Foo.Bar;
/* @internal */
export type strims_test_Bar_Foo_IBar = Bar.Foo.IBar;
/* @internal */
export const strims_test_TestMessage_TestEnum = TestMessage.TestEnum;
/* @internal */
export type strims_test_TestMessage_TestEnum = TestMessage.TestEnum;
