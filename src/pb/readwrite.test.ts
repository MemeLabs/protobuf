import assert from "assert";

import { TestMessage } from "../apis/strims/test/message";
import { big32, bigmaxi64, bigmaxu32, bigmaxu64 } from "./big";
import Reader from "./reader";
import Writer from "./writer";

describe("Message", function () {
  it("decoded message should match encoded message", function () {
    const src = new TestMessage({
      int32Value: 1234567,
      int64Value: BigInt(1234567890000),
      uint32Value: 1234567,
      uint64Value: BigInt(1234567890000),
      sint32Value: 1234567,
      sint64Value: BigInt(1234567890000),
      boolValue: true,
      enumValue: TestMessage.TestEnum.TEST_ENUM_VAL_2,
      fixed64Value: BigInt(1234567890000),
      sfixed64Value: BigInt(1234567890000),
      doubleValue: 1234567,
      stringValue: "some string value",
      bytesValue: new Uint8Array([1, 2, 3, 4, 5, 6, 7]),
      fixed32Value: 1234567,
      sfixedValue: 1234567,
      floatValue: 1234567,
    });
    const buf = TestMessage.encode(src).finish();
    const dst = TestMessage.decode(buf);
    assert.deepStrictEqual(src, dst);
  });
});

describe("Writer/Reader", function () {
  const uint32s = [1, 100, 10000, 1000000, 100000000, 0xffffffff];

  it("should encode/decode uint32", function () {
    uint32s.forEach((v) => {
      const w = new Writer();
      w.uint32(v);
      const r = new Reader(w.finish());
      assert.strictEqual(r.uint32(), v);
    });
  });

  it("should encode/decode fixed32", function () {
    uint32s.forEach((v) => {
      const w = new Writer();
      w.fixed32(v);
      const r = new Reader(w.finish());
      assert.strictEqual(r.fixed32(), v);
    });
  });

  const int32s = [1, 100, 10000, 1000000, 100000000, 0x7fffffff];
  int32s.push(...int32s.map((v) => -v));

  it("should encode/decode int32", function () {
    int32s.forEach((v) => {
      const w = new Writer();
      w.int32(v);
      const r = new Reader(w.finish());
      assert.strictEqual(r.int32(), v);
    });
  });

  it("should encode/decode sint32", function () {
    int32s.forEach((v) => {
      const w = new Writer();
      w.sint32(v);
      const r = new Reader(w.finish());
      assert.strictEqual(r.sint32(), v);
    });
  });

  it("should encode/decode sfixed32", function () {
    int32s.forEach((v) => {
      const w = new Writer();
      w.sfixed32(v);
      const r = new Reader(w.finish());
      assert.strictEqual(r.sfixed32(), v);
    });
  });

  const uint64s = [
    BigInt(1),
    BigInt(100),
    BigInt(10000),
    BigInt(1000000),
    BigInt(100000000),
    BigInt(10000000000),
    BigInt(1000000000000),
    BigInt(100000000000000),
    BigInt(10000000000000000),
    BigInt(1000000000000000000),
    bigmaxu64,
  ];

  it("should encode/decode uint64", function () {
    uint64s.forEach((v) => {
      const w = new Writer();
      w.uint64(v);
      const r = new Reader(w.finish());
      assert.strictEqual(r.uint64(), v);
    });
  });

  it("should encode/decode fixed64", function () {
    uint64s.forEach((v) => {
      const w = new Writer();
      w.fixed64(v);
      const r = new Reader(w.finish());
      assert.strictEqual(r.fixed64(), v);
    });
  });

  const int64s = [
    BigInt(1),
    BigInt(100),
    BigInt(10000),
    BigInt(1000000),
    BigInt(100000000),
    BigInt(10000000000),
    BigInt(1000000000000),
    BigInt(100000000000000),
    BigInt(10000000000000000),
    BigInt(1000000000000000000),
    (bigmaxu32 << big32) & bigmaxi64,
    bigmaxi64,
  ];
  int64s.push(...int64s.map((v) => -v));

  it("should encode/decode int64", function () {
    int64s.forEach((v) => {
      const w = new Writer();
      w.int64(v);
      const r = new Reader(w.finish());
      assert.strictEqual(r.int64(), v);
    });
  });

  it("should encode/decode sint64", function () {
    int64s.forEach((v) => {
      const w = new Writer();
      w.sint64(v);
      const r = new Reader(w.finish());
      assert.strictEqual(r.sint64(), v);
    });
  });

  it("should encode/decode sfixed64", function () {
    int64s.forEach((v) => {
      const w = new Writer();
      w.sfixed64(v);
      const r = new Reader(w.finish());
      assert.strictEqual(r.sfixed64(), v);
    });
  });
});
