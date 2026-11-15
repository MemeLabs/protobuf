import { big1, big32 } from "./big";
import { readFloat32, readFloat64 } from "./float";

const textDecoder = new TextDecoder();

// Thrown by any read past the end of the buffer.
const outOfRange = (): Error => new Error("index out of range");

// Thrown for a varint over 10 bytes, or whose 10th byte is over 1.
const invalidVarint = (): Error => new Error("invalid varint");

export default class Reader {
  buf: Uint8Array;
  pos = 0;

  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  get len(): number {
    return this.buf.byteLength;
  }

  skip(n: number): void {
    if (this.pos + n > this.len) {
      throw outOfRange();
    }
    this.pos += n;
  }

  skipType(wireType: number): void {
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
      case 3:
        // a group: its fields, up to the end-group tag
        for (let tag = this.uint32(); (tag & 7) !== 4; tag = this.uint32()) {
          this.skipType(tag & 7);
        }
        break;
      case 5:
        this.skip(4);
        break;
      default:
        // 4, an end-group tag outside a group, and the unused 6 and 7
        throw new Error(`invalid wire type ${wireType}`);
    }
  }

  private skipVarint(): void {
    for (let n = 1; ; n++) {
      if (this.pos >= this.len) {
        throw outOfRange();
      }
      const b = this.buf[this.pos++];
      if (n === 10 && b > 1) {
        throw invalidVarint();
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

  // Reads a varint's low 32 bits. Reading past the end gives undefined, which
  // ends the varint, so one check after it is enough.
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
                throw invalidVarint();
              }
            }
          }
        }
      }
    }
    if (pos > buf.byteLength) {
      throw outOfRange();
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
          throw invalidVarint();
        }
        hi |= (b & 127) << shift;
      }
    }

    if (pos > buf.byteLength) {
      throw outOfRange();
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
    if (this.pos + 8 > this.len) {
      throw outOfRange();
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
    if (end > this.len) {
      throw outOfRange();
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
    if (pos + 4 > buf.byteLength) {
      throw outOfRange();
    }
    this.pos = pos + 4;
    return buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16) | (buf[pos + 3] << 24);
  }

  float(): number {
    if (this.pos + 4 > this.len) {
      throw outOfRange();
    }
    const v = readFloat32(this.buf, this.pos);
    this.pos += 4;
    return v;
  }
}
