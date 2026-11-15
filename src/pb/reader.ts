import { big1, big32 } from "./big";
import { readFloat32, readFloat64 } from "./float";

const textDecoder = new TextDecoder();

// An error thrown as this one instance every time, with no stack.
const shared = (message: string): Error => {
  const e = new Error(message);
  e.stack = `Error: ${message}`;
  return e;
};

// Thrown by any read past end.
const outOfRange = shared("index out of range");

// Thrown for a varint over 10 bytes, or whose 10th byte is over 1.
const invalidVarint = shared("invalid varint");

// Thrown by skipType for wire type 4 (an end-group tag outside a group), 6
// and 7, the wire types a tag can have that aren't values.
const invalidWireType: { [wireType: number]: Error } = {
  4: shared("invalid wire type 4"),
  6: shared("invalid wire type 6"),
  7: shared("invalid wire type 7"),
};

const recursionLimitExceeded = (limit: number): Error =>
  new Error(`exceeded maximum recursion depth (limit ${limit})`);

/** A Reader's options. */
export interface ReaderOptions {
  /**
   * How many levels messages may nest, the outermost counting as 1, as Go's
   * proto.UnmarshalOptions.RecursionLimit: each nested message, map entry and
   * unknown group being skipped is a level, except a message of a type with no
   * fields. At least 1; Infinity sets no limit. Defaults to
   * Reader.defaultRecursionLimit.
   */
  recursionLimit?: number;
}

/**
 * Reads the protobuf wire format. A Reader must not be used after it throws.
 * Decode errors carry no meaningful stack: reads past end, invalid varints
 * and invalid wire types each throw one shared Error instance.
 */
export default class Reader {
  /** The recursionLimit of every Reader constructed afterwards without one. */
  static defaultRecursionLimit = 100;

  buf: Uint8Array;
  pos = 0;
  /** The end of the message being read; reads past it throw. Initially len. */
  end: number;
  readonly recursionLimit: number;
  // the levels left
  private depth: number;

  // Throws a RangeError if the recursion limit is under 1 or NaN.
  constructor(buf: Uint8Array, options?: ReaderOptions) {
    const limit = options?.recursionLimit ?? Reader.defaultRecursionLimit;
    if (!(limit >= 1)) {
      throw new RangeError(`invalid recursion limit ${limit}`);
    }
    this.buf = buf;
    this.end = buf.byteLength;
    this.recursionLimit = limit;
    this.depth = limit;
  }

  // The buffer's length.
  get len(): number {
    return this.buf.byteLength;
  }

  // Starts reading a message of length bytes, or to end when length is
  // undefined: takes a level and sets end to the message's end. Returns the
  // previous end, for leave. Throws if no level is left or the message runs
  // past end.
  enter(length?: number): number {
    if (--this.depth < 0) {
      throw recursionLimitExceeded(this.recursionLimit);
    }
    const parentEnd = this.end;
    if (length !== undefined) {
      const end = this.pos + length;
      if (end > parentEnd) {
        throw outOfRange;
      }
      this.end = end;
    }
    return parentEnd;
  }

  // Finishes reading the message enter started: gives its level back and
  // restores end to parentEnd, what enter returned.
  leave(parentEnd: number): void {
    this.depth++;
    this.end = parentEnd;
  }

  skip(n: number): void {
    if (this.pos + n > this.end) {
      throw outOfRange;
    }
    this.pos += n;
  }

  // Skips the value of a field of wireType. A group takes a level, and its
  // end-group tag must have fieldNumber when that is given. Throws on wire
  // type 4, 6 or 7, a mismatched end-group tag, or no level left.
  skipType(wireType: number, fieldNumber?: number): void {
    switch (wireType) {
      case 0:
        this.skipVarint();
        break;
      case 1:
        this.skip(8);
        break;
      case 2:
        this.skip(this.uint32());
        break;
      case 3: {
        // a group: its fields, up to the end-group tag
        if (--this.depth < 0) {
          throw recursionLimitExceeded(this.recursionLimit);
        }
        let tag = this.uint32();
        for (; (tag & 7) !== 4; tag = this.uint32()) {
          this.skipType(tag & 7, tag >>> 3);
        }
        if (fieldNumber !== undefined && tag >>> 3 !== fieldNumber) {
          throw new Error(`end-group tag for field ${tag >>> 3} in group ${fieldNumber}`);
        }
        this.depth++;
        break;
      }
      case 5:
        this.skip(4);
        break;
      default:
        // 4, an end-group tag outside a group, and the unused 6 and 7; any
        // other value isn't a tag's
        throw invalidWireType[wireType] ?? new Error(`invalid wire type ${wireType}`);
    }
  }

  private skipVarint(): void {
    for (let n = 1; ; n++) {
      if (this.pos >= this.end) {
        throw outOfRange;
      }
      const b = this.buf[this.pos++];
      // past the buffer, whatever end is
      if (b === undefined) {
        throw outOfRange;
      }
      if (n === 10 && b > 1) {
        throw invalidVarint;
      }
      if (b < 128) {
        return;
      }
    }
  }

  int32(): number {
    return this.uint32() | 0;
  }

  int64(): bigint {
    return BigInt.asIntN(64, this.uint64());
  }

  // Reads a varint's low 32 bits. Reading past the buffer gives undefined,
  // which ends the varint, so one check against end after it is enough.
  uint32(): number {
    const buf = this.buf;
    let pos = this.pos;
    let b = buf[pos++];
    let v = b & 127;
    if (b > 127) {
      b = buf[pos++];
      v |= (b & 127) << 7;
      if (b > 127) {
        b = buf[pos++];
        v |= (b & 127) << 14;
        if (b > 127) {
          b = buf[pos++];
          v |= (b & 127) << 21;
          if (b > 127) {
            b = buf[pos++];
            v |= (b & 15) << 28;
            // the rest of a sign-extended 10-byte varint; bits past 32 are dropped
            for (let n = 6; b > 127; n++) {
              b = buf[pos++];
              if (n === 10 && b > 1) {
                throw invalidVarint;
              }
            }
          }
        }
      }
    }
    if (pos > this.end) {
      throw outOfRange;
    }
    this.pos = pos;
    return v >>> 0;
  }

  uint64(): bigint {
    const buf = this.buf;
    let pos = this.pos;
    let b: number;

    // bits 0 to 27, 7 a byte
    let lo = 0;
    let shift = 0;
    do {
      b = buf[pos++];
      lo |= (b & 127) << shift;
      shift += 7;
    } while (b > 127 && shift < 28);

    // the 5th byte's bits straddle lo and hi; bits 35 to 63 follow
    let hi = 0;
    if (b > 127) {
      b = buf[pos++];
      lo |= (b & 15) << 28;
      hi = (b & 127) >> 4;
      for (shift = 3; b > 127; shift += 7) {
        b = buf[pos++];
        if (shift === 31 && b > 1) {
          throw invalidVarint;
        }
        hi |= (b & 127) << shift;
      }
    }

    if (pos > this.end) {
      throw outOfRange;
    }
    this.pos = pos;
    return hi === 0 ? BigInt(lo >>> 0) : (BigInt(hi >>> 0) << big32) | BigInt(lo >>> 0);
  }

  sint32(): number {
    const v = this.uint32();
    return (v >>> 1) ^ -(v & 1);
  }

  sint64(): bigint {
    const v = this.uint64();
    return (v >> big1) ^ -(v & big1);
  }

  bool(): boolean {
    return this.uint32() !== 0;
  }

  enum(): number {
    return this.uint32();
  }

  fixed64(): bigint {
    const lo = this.fixed32();
    const hi = this.fixed32();
    return (BigInt(hi) << big32) | BigInt(lo);
  }

  sfixed64(): bigint {
    return BigInt.asIntN(64, this.fixed64());
  }

  double(): number {
    if (this.pos + 8 > this.end) {
      throw outOfRange;
    }
    const v = readFloat64(this.buf, this.pos);
    this.pos += 8;
    return v;
  }

  string(): string {
    return textDecoder.decode(this.bytes());
  }

  bytes(): Uint8Array {
    const len = this.uint32();
    const end = this.pos + len;
    if (end > this.end) {
      throw outOfRange;
    }
    const v = this.buf.subarray(this.pos, end);
    this.pos = end;
    return v;
  }

  fixed32(): number {
    return this.sfixed32() >>> 0;
  }

  sfixed32(): number {
    const buf = this.buf;
    const pos = this.pos;
    if (pos + 4 > this.end) {
      throw outOfRange;
    }
    this.pos = pos + 4;
    return buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16) | (buf[pos + 3] << 24);
  }

  float(): number {
    if (this.pos + 4 > this.end) {
      throw outOfRange;
    }
    const v = readFloat32(this.buf, this.pos);
    this.pos += 4;
    return v;
  }
}
