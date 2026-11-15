import assert from "assert";

import { Call, Error as RPCError } from "../apis/strims/rpc/rpc";
import { Bar_Foo, TestMessage, TestMessage_EmbeddedMessage } from "../apis/strims/test/message";
import { MapNode } from "../apis/strims/test/recursion";
import Reader from "./reader";
import Writer from "./writer";

const bytes = (...b: number[]) => new Uint8Array(b);

const outOfRange = /index out of range/;
const tooDeep = /exceeded maximum recursion depth/;

// A chain of levels Bar_Foo messages, the root counting as 1, each holding
// the next as testBarFoo (field 2); inner is the last one's bytes.
const chain = (levels: number, inner: Uint8Array = new Uint8Array()): Uint8Array => {
  let b = inner;
  for (let i = 1; i < levels; i++) {
    b = new Writer()
      .uint32((2 << 3) | 2)
      .bytes(b)
      .finish()
      .slice();
  }
  return b;
};

// the levels of a decoded chain
const depth = (m: Bar_Foo): number => {
  let n = 1;
  for (; m.testBarFoo; m = m.testBarFoo) n++;
  return n;
};

// an unknown group, field 9, nested n deep
const groups = (n: number): Uint8Array => {
  const w = new Writer();
  for (let i = 0; i < n; i++) w.uint32((9 << 3) | 3);
  for (let i = 0; i < n; i++) w.uint32((9 << 3) | 4);
  return w.finish().slice();
};

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

  it("throws one shared Error for each cheap failure, at a fraction of a new Error's cost", function () {
    const caught = (f: () => unknown): unknown => {
      try {
        f();
      } catch (e) {
        return e;
      }
      return assert.fail("didn't throw");
    };
    const long = bytes(...new Array<number>(10).fill(0x80), 0x01);
    const kinds: [string, () => unknown, () => unknown][] = [
      [
        "out of range",
        () => new Reader(bytes(0x80)).uint32(),
        () => RPCError.decode(bytes(0x0a, 5)),
      ],
      ["invalid varint", () => new Reader(long).uint32(), () => new Reader(long).skipType(0)],
      [
        "invalid wire type",
        () => new Reader(bytes()).skipType(6),
        () => RPCError.decode(bytes((15 << 3) | 6)),
      ],
    ];
    for (const [name, a, b] of kinds) {
      const e = caught(a);
      assert.ok(e instanceof Error, name);
      assert.strictEqual(caught(b), e, name);
    }

    // A decode that throws on a truncated tag, as a flood of frames would
    // send it, costs less than making the Error alone would: about half.
    const truncated = bytes(0x08, 0x80);
    const n = 20000;
    const best = (f: () => void) => {
      let ms = Infinity;
      for (let k = 0; k < 7; k++) {
        const start = performance.now();
        f();
        ms = Math.min(ms, performance.now() - start);
      }
      return ms;
    };
    const decodes = best(() => {
      for (let i = 0; i < n; i++) caught(() => RPCError.decode(truncated));
    });
    const errors = best(() => {
      for (let i = 0; i < n; i++) {
        caught(() => {
          throw new Error("index out of range");
        });
      }
    });
    assert.ok(decodes < errors, `${n} decodes took ${decodes} ms, ${n} new Errors ${errors} ms`);
  });
});

describe("Reader recursion limit", function () {
  it("decodes 100 levels by default, the root counting as 1, and throws on 101", function () {
    assert.strictEqual(new Reader(bytes()).recursionLimit, 100);
    assert.strictEqual(depth(Bar_Foo.decode(chain(100))), 100);
    assert.throws(
      () => Bar_Foo.decode(chain(101)),
      /^Error: exceeded maximum recursion depth \(limit 100\)$/
    );
  });

  for (const limit of [1, 5, 250]) {
    it(`decodes ${limit} levels with a limit of ${limit}, and throws on ${limit + 1}`, function () {
      const decode = (levels: number) =>
        Bar_Foo.decode(new Reader(chain(levels), { recursionLimit: limit }));
      assert.strictEqual(depth(decode(limit)), limit);
      assert.throws(() => decode(limit + 1), tooDeep);
    });
  }

  it("sets no limit with Infinity", function () {
    const buf = chain(1000);
    assert.throws(() => Bar_Foo.decode(buf), tooDeep);
    assert.strictEqual(depth(Bar_Foo.decode(new Reader(buf, { recursionLimit: Infinity }))), 1000);
  });

  it("throws a RangeError for a limit under 1 or NaN", function () {
    for (const recursionLimit of [0, -1, 0.5, NaN]) {
      assert.throws(() => new Reader(bytes(), { recursionLimit }), RangeError, `${recursionLimit}`);
    }
  });

  it("applies Reader.defaultRecursionLimit to Readers constructed afterwards", function () {
    const prev = Reader.defaultRecursionLimit;
    const before = new Reader(chain(11));
    try {
      Reader.defaultRecursionLimit = 10;
      assert.throws(() => Bar_Foo.decode(chain(11)), /\(limit 10\)/);
      assert.strictEqual(depth(Bar_Foo.decode(chain(10))), 10);
      assert.strictEqual(depth(Bar_Foo.decode(before)), 11);
      Reader.defaultRecursionLimit = 0;
      assert.throws(() => new Reader(bytes()), RangeError);
    } finally {
      Reader.defaultRecursionLimit = prev;
    }
  });

  it("counts embedded, repeated and map-value messages, and map entries, as Go does", function () {
    const value = () => new TestMessage_EmbeddedMessage({ embeddedValue: 7 });
    // each with the levels it takes, the root's included: Go's limit of
    // levels decodes it, and one less rejects it
    const cases: [string, number, TestMessage, (m: TestMessage) => number][] = [
      [
        "embedded",
        2,
        new TestMessage({ embeddedMessageValue: value() }),
        (m) => m.embeddedMessageValue.embeddedValue,
      ],
      [
        "repeated",
        2,
        new TestMessage({ repeatedEmbeddedMessageMapValue: [value()] }),
        (m) => m.repeatedEmbeddedMessageMapValue[0].embeddedValue,
      ],
      [
        "map value, in its entry",
        3,
        new TestMessage({ stringEmbeddedMessageMapValue: { a: value() } }),
        (m) => m.stringEmbeddedMessageMapValue.get("a").embeddedValue,
      ],
      [
        "scalar map entry",
        2,
        new TestMessage({ int32Int32MapValue: { 1: 7 } }),
        (m) => m.int32Int32MapValue.get(1),
      ],
    ];
    for (const [name, levels, src, get] of cases) {
      const buf = TestMessage.encode(src).finish().slice();
      const decode = (recursionLimit: number) =>
        TestMessage.decode(new Reader(buf, { recursionLimit }));
      assert.throws(() => decode(levels - 1), tooDeep, name);
      assert.strictEqual(get(decode(levels)), 7, name);
    }
  });

  describe("map entries", function () {
    // a MapNode nested hops deep through children["k"], each hop an entry
    // and its value: 1 + 2 * hops levels
    const mapChain = (hops: number, inner = new MapNode()): Uint8Array => {
      let m = inner;
      for (let i = 0; i < hops; i++) m = new MapNode({ children: { k: m } });
      return MapNode.encode(m).finish().slice();
    };
    const hopsOf = (m: MapNode): number => {
      let n = 0;
      for (; m.children.has("k"); m = m.children.get("k")) n++;
      return n;
    };

    it("decodes a chain of 99 levels through map values, and throws on 101, as Go does", function () {
      assert.strictEqual(hopsOf(MapNode.decode(mapChain(49))), 49);
      assert.throws(() => MapNode.decode(mapChain(50)), tooDeep);
    });

    it("counts a scalar map's entry at the limit, as Go does", function () {
      // 99 levels, and an entry of values at the 100th
      const buf = mapChain(49, new MapNode({ values: { 1: 2 } }));
      let m = MapNode.decode(buf);
      while (m.children.has("k")) m = m.children.get("k");
      assert.strictEqual(m.values.get(1), 2);
      assert.throws(() => MapNode.decode(new Reader(buf, { recursionLimit: 99 })), tooDeep);
    });

    it("throws on an entry running past its message's end", function () {
      // MapNode { values (field 2): an entry of 5 bytes, 2 of them in the message }
      assert.throws(() => MapNode.decode(bytes(0x12, 0x05, 0x08, 0x01)), outOfRange);
      // an entry of 2 bytes whose key varint runs past them into the next
      assert.throws(() => MapNode.decode(bytes(0x12, 0x02, 0x08, 0x80, 0x01)), outOfRange);
    });
  });

  it("doesn't count an empty message type, which can't nest", function () {
    // Bar_Foo's testFoo is a Foo, which has no fields
    let m = Bar_Foo.decode(chain(100, bytes((1 << 3) | 2, 0)));
    while (m.testBarFoo) m = m.testBarFoo;
    assert.ok(m.testFoo);
  });

  it("gives its levels back, so one Reader decodes messages one after another", function () {
    const r = new Reader(new Writer().bytes(chain(100)).bytes(chain(100)).finish());
    for (let n = 0; n < 2; n++) {
      assert.strictEqual(depth(Bar_Foo.decode(r, r.uint32())), 100);
    }
    assert.strictEqual(r.pos, r.len);
    assert.strictEqual(r.end, r.len);
  });

  describe("unknown groups", function () {
    it("counts each group being skipped as a level", function () {
      // the message is the first level
      assert.strictEqual(RPCError.decode(groups(99)).message, "");
      assert.throws(() => RPCError.decode(groups(100)), tooDeep);
    });

    it("gives a group's level back, so 100 sibling groups decode beside nested ones", function () {
      const siblings = new Writer();
      for (let i = 0; i < 100; i++) siblings.uint32((9 << 3) | 3).uint32((9 << 3) | 4);
      const buf = (nested: number) => bytes(...siblings.finish(), ...groups(nested));
      assert.strictEqual(RPCError.decode(buf(99)).message, "");
      assert.throws(() => RPCError.decode(buf(100)), tooDeep);
    });

    it("shares the limit with the messages enclosing them", function () {
      assert.doesNotThrow(() => Bar_Foo.decode(chain(50, groups(50))));
      assert.throws(() => Bar_Foo.decode(chain(50, groups(51))), tooDeep);
    });

    it("takes the Reader's limit when skipped directly", function () {
      const skip = (n: number) => {
        const r = new Reader(groups(n), { recursionLimit: 3 });
        r.uint32(); // the start-group tag
        r.skipType(3, 9);
        return r;
      };
      assert.strictEqual(skip(3).pos, 6);
      assert.throws(() => skip(4), tooDeep);
    });

    it("throws on an end-group tag for another field", function () {
      const mismatched = /end-group tag for field 8 in group 9/;
      assert.throws(() => RPCError.decode(bytes((9 << 3) | 3, (8 << 3) | 4)), mismatched);
      // nested in a matched group
      const nested = bytes((7 << 3) | 3, (9 << 3) | 3, (8 << 3) | 4, (7 << 3) | 4);
      assert.throws(() => RPCError.decode(nested), mismatched);
      // a nested group's is checked without the outer field number
      const r = new Reader(nested);
      r.uint32();
      assert.throws(() => r.skipType(3), mismatched);
      // in a map entry: TestMessage's string_string_map_value, field 21
      const entry = bytes(0xaa, 0x01, 2, (9 << 3) | 3, (8 << 3) | 4);
      assert.throws(() => TestMessage.decode(entry), mismatched);
    });
  });
});

describe("Reader message bounds", function () {
  it("throws on a nested message running past its parent's end", function () {
    // Bar_Foo { testBarFoo: Bar_Foo (2 bytes) { testBarFoo: 2 bytes } }: the
    // innermost 2 bytes, an unknown varint field, are the root's, past their
    // parent's end
    assert.throws(() => Bar_Foo.decode(bytes(0x12, 0x02, 0x12, 0x02, 0x78, 0x00)), outOfRange);
  });

  it("throws at once on a nested message of 4 GiB", function () {
    const start = Date.now();
    assert.throws(() => Bar_Foo.decode(bytes(0x12, 0xff, 0xff, 0xff, 0xff, 0x0f)), outOfRange);
    assert.ok(Date.now() - start < 1000);
  });

  describe("reads past a message's end throw", function () {
    const w = () => new Writer();
    const big = BigInt(1) << BigInt(40);
    // each read's bytes, then 16 more in the buffer
    const cases: [string, Uint8Array, (r: Reader) => unknown][] = [
      ["uint32", w().uint32(300).finish(), (r) => r.uint32()],
      ["int32", w().int32(-1).finish(), (r) => r.int32()],
      ["sint32", w().sint32(-300).finish(), (r) => r.sint32()],
      ["bool", w().bool(true).finish(), (r) => r.bool()],
      ["enum", w().enum(300).finish(), (r) => r.enum()],
      ["uint64", w().uint64(big).finish(), (r) => r.uint64()],
      ["int64", w().int64(-big).finish(), (r) => r.int64()],
      ["sint64", w().sint64(-big).finish(), (r) => r.sint64()],
      ["fixed32", w().fixed32(1).finish(), (r) => r.fixed32()],
      ["sfixed32", w().sfixed32(-1).finish(), (r) => r.sfixed32()],
      ["fixed64", w().fixed64(big).finish(), (r) => r.fixed64()],
      ["sfixed64", w().sfixed64(-big).finish(), (r) => r.sfixed64()],
      ["float", w().float(1.5).finish(), (r) => r.float()],
      ["double", w().double(1.5).finish(), (r) => r.double()],
      // 3 bytes, length first
      ["bytes", bytes(3, 1, 2, 3), (r) => r.bytes()],
      ["string", w().string("abc").finish(), (r) => r.string()],
      ["skip", bytes(1, 2, 3, 4), (r) => r.skip(4)],
      ["a skipped varint", w().uint64(big).finish(), (r) => r.skipType(0)],
      ["a skipped fixed64", w().fixed64(big).finish(), (r) => r.skipType(1)],
      ["a skipped length-delimited field", bytes(3, 1, 2, 3), (r) => r.skipType(2)],
      // a group's body: field 9 = 1, then its end-group tag
      ["a skipped group", bytes(9 << 3, 1, (9 << 3) | 4), (r) => r.skipType(3, 9)],
      ["a skipped fixed32", w().fixed32(1).finish(), (r) => r.skipType(5)],
    ];
    for (const [name, value, read] of cases) {
      it(name, function () {
        const buf = bytes(...value, ...new Array<number>(16).fill(0));
        const short = new Reader(buf);
        short.enter(value.length - 1);
        assert.throws(() => read(short), outOfRange);
        const exact = new Reader(buf);
        exact.enter(value.length);
        read(exact);
        assert.strictEqual(exact.pos, value.length);
      });
    }
  });

  it("throws on a field running past its message's end", function () {
    // TestMessage { embeddedMessageValue (field 17): 2 bytes }, then the
    // root's bytes
    const embedded = (...b: number[]) => bytes(0x8a, 0x01, 2, ...b);
    // embeddedValue, a varint continued past the 2 bytes
    assert.throws(() => TestMessage.decode(embedded(0x08, 0x80, 0x01)), outOfRange);
    // an unknown length-delimited field of 2 bytes
    assert.throws(() => TestMessage.decode(embedded(0x12, 0x02, 0x78, 0x00)), outOfRange);
    // a string longer than the length decode is given
    const r = new Reader(bytes(0x0a, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f));
    assert.throws(() => RPCError.decode(r, 3), outOfRange);
  });

  it("throws on a length past the buffer before reading the message", function () {
    const r = new Reader(bytes(0x12, 0));
    assert.throws(() => Bar_Foo.decode(r, 5), outOfRange);
    assert.strictEqual(r.pos, 0);
  });
});

describe("Reader with code generated before Reader.enter", function () {
  // Bar_Foo.decode as protoc-gen-ts generated it before Reader.enter
  const decodeOld = (r: Reader | Uint8Array, length?: number): Bar_Foo => {
    r = r instanceof Reader ? r : new Reader(r);
    const end = length === undefined ? r.len : r.pos + length;
    const m = new Bar_Foo();
    while (r.pos < end) {
      const tag = r.uint32();
      switch (tag >> 3) {
        case 2:
          m.testBarFoo = decodeOld(r, r.uint32());
          break;
        default:
          r.skipType(tag & 7);
          break;
      }
    }
    return m;
  };

  it("decodes, with no message limit", function () {
    assert.strictEqual(depth(decodeOld(chain(150))), 150);
    const r = new Reader(new Writer().bytes(chain(20)).bytes(chain(20)).finish());
    while (r.pos < r.len) assert.strictEqual(depth(decodeOld(r, r.uint32())), 20);
  });

  it("still limits unknown groups", function () {
    assert.doesNotThrow(() => decodeOld(groups(100)));
    assert.throws(() => decodeOld(groups(101)), tooDeep);
  });
});
