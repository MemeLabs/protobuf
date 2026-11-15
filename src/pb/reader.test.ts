import assert from "assert";

import { Call, Error as RPCError } from "../apis/strims/rpc/rpc";
import Reader from "./reader";
import Writer from "./writer";

const bytes = (...b: number[]) => new Uint8Array(b);

const outOfRange = /index out of range/;

describe("Reader", function () {
  describe("reads past the end throw", function () {
    const cases: [string, Uint8Array, (r: Reader) => unknown][] = [
      ["uint32 on an empty buffer", bytes(), (r) => r.uint32()],
      ["uint32 cut short", bytes(0x80, 0x80), (r) => r.uint32()],
      ["uint64 cut short", bytes(0xff, 0xff, 0xff, 0xff, 0xff, 0xff), (r) => r.uint64()],
      ["int32 cut short", bytes(0xff, 0xff, 0xff, 0xff, 0xff, 0xff), (r) => r.int32()],
      ["bytes longer than the buffer", bytes(5, 1, 2), (r) => r.bytes()],
      ["string longer than the buffer", bytes(5, 0x61), (r) => r.string()],
      ["fixed32", bytes(1, 2, 3), (r) => r.fixed32()],
      ["sfixed32", bytes(1), (r) => r.sfixed32()],
      ["fixed64", bytes(1, 2, 3, 4, 5, 6, 7), (r) => r.fixed64()],
      ["float", bytes(1, 2), (r) => r.float()],
      ["double", bytes(1, 2, 3, 4), (r) => r.double()],
      ["a skipped varint", bytes(0x80), (r) => r.skipType(0)],
      ["a skipped fixed64", bytes(1, 2), (r) => r.skipType(1)],
      ["a skipped length-delimited field", bytes(4, 1), (r) => r.skipType(2)],
      ["a skipped fixed32", bytes(1), (r) => r.skipType(5)],
    ];
    for (const [name, buf, read] of cases) {
      it(name, function () {
        const r = new Reader(buf);
        assert.throws(() => read(r), outOfRange);
      });
    }
  });

  it("leaves pos alone when a read throws", function () {
    const r = new Reader(bytes(5, 1, 2));
    assert.throws(() => r.bytes(), outOfRange);
    assert.strictEqual(r.pos, 1); // past the length, which it read
    const r2 = new Reader(bytes(0x80));
    assert.throws(() => r2.uint32(), outOfRange);
    assert.strictEqual(r2.pos, 0);
  });

  it("reads a value that ends exactly at the end", function () {
    const w = new Writer();
    w.uint32(300)
      .bytes(bytes(1, 2, 3))
      .fixed32(7)
      .double(1.5);
    const r = new Reader(w.finish());
    assert.strictEqual(r.uint32(), 300);
    assert.deepStrictEqual(r.bytes(), bytes(1, 2, 3));
    assert.strictEqual(r.fixed32(), 7);
    assert.strictEqual(r.double(), 1.5);
    assert.strictEqual(r.pos, r.len);
  });

  it("reads the 10-byte varint the Go runtime writes for a negative int32", function () {
    // rpc.Error{code: -1, message: "hi"}, code first: the bytes after the
    // varint's 5th must be consumed with it
    const buf = bytes(0x10, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01);
    const r = new Reader(buf);
    r.uint32(); // the tag
    assert.strictEqual(r.int32(), -1);
    assert.strictEqual(r.pos, buf.length);

    const m = RPCError.decode(bytes(...buf, 0x0a, 0x02, 0x68, 0x69));
    assert.strictEqual(m.code, -1);
    assert.strictEqual(m.message, "hi");
  });

  it("throws on a varint longer than 10 bytes", function () {
    const long = bytes(...new Array<number>(10).fill(0x80), 0x01);
    assert.throws(() => new Reader(long).uint32(), /invalid varint/);
    assert.throws(() => new Reader(long).uint64(), /invalid varint/);
    assert.throws(() => new Reader(long).skipType(0), /invalid varint/);
  });

  it("throws on a 10-byte varint whose last byte is over 1, as the Go runtime does", function () {
    const varint = (last: number) => bytes(...new Array<number>(9).fill(0xff), last);
    for (const read of [
      (r: Reader) => r.uint32(),
      (r: Reader) => r.int32(),
      (r: Reader) => r.uint64(),
      (r: Reader) => r.skipType(0),
    ]) {
      assert.throws(() => read(new Reader(varint(0x02))), /invalid varint/);
      assert.throws(() => read(new Reader(varint(0x7f))), /invalid varint/);
      const r = new Reader(varint(0x01));
      assert.doesNotThrow(() => read(r));
      assert.strictEqual(r.pos, 10);
    }
  });

  it("reads the largest uint64", function () {
    const max = (BigInt(1) << BigInt(64)) - BigInt(1);
    const r = new Reader(new Writer().uint64(max).finish());
    assert.strictEqual(r.uint64(), max);
    assert.strictEqual(r.pos, r.len);
  });

  describe("skipType", function () {
    it("skips an unknown multi-byte varint field", function () {
      // field 15 = 300, then rpc.Error's message, "hi"
      const m = RPCError.decode(bytes(0x78, 0xac, 0x02, 0x0a, 0x02, 0x68, 0x69));
      assert.strictEqual(m.message, "hi");
    });

    it("skips an unknown single-byte varint field followed by a long tag", function () {
      // field 15 = 5, field 16 = 1 (a 2-byte tag), then the message
      const m = RPCError.decode(bytes(0x78, 0x05, 0x80, 0x01, 0x01, 0x0a, 0x02, 0x68, 0x69));
      assert.strictEqual(m.message, "hi");
    });

    it("skips unknown fields of every wire type", function () {
      const w = new Writer();
      w.uint32((20 << 3) | 0).uint64(BigInt("18446744073709551615"));
      w.uint32((21 << 3) | 1).fixed64(BigInt(1));
      w.uint32((22 << 3) | 2).bytes(bytes(1, 2, 3));
      w.uint32((23 << 3) | 5).fixed32(1);
      // a group, with a nested group, then its end
      w.uint32((24 << 3) | 3)
        .uint32((1 << 3) | 0)
        .uint32(300);
      w.uint32((2 << 3) | 3).uint32((2 << 3) | 4);
      w.uint32((24 << 3) | 4);
      w.uint32((1 << 3) | 2).string("hi");
      w.uint32((2 << 3) | 0).int32(7);
      const m = RPCError.decode(w.finish());
      assert.strictEqual(m.message, "hi");
      assert.strictEqual(m.code, 7);
    });

    for (const wireType of [4, 6, 7]) {
      it(`throws on wire type ${wireType}`, function () {
        assert.throws(() => new Reader(bytes(0, 0, 0, 0)).skipType(wireType), /invalid wire type/);
        assert.throws(() => RPCError.decode(bytes((15 << 3) | wireType, 0)), /invalid wire type/);
      });
    }
  });

  it("throws decoding a message cut inside a field", function () {
    const src = new Call({ argument: new Uint8Array(100).fill(7) });
    const buf = Call.encode(src).finish();
    assert.deepStrictEqual(Call.decode(buf), src);
    // one field, so every cut is inside it
    for (let n = 1; n < buf.length; n++) {
      assert.throws(() => Call.decode(buf.subarray(0, n)), outOfRange, `cut at ${n}`);
    }
  });
});
