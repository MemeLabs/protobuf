import { big0, big1, big32, big63, bigmaxi64 } from "./big";
import { readFloat32, readFloat64 } from "./float";

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
      throw new Error("index out of range");
    }
    this.pos += n;
  }

  skipType(wireType: number): void {
    switch (wireType) {
      case 0:
        do {
          this.skip(1);
        } while (this.buf[this.pos] & 0x80);
        break;
      case 1:
        this.skip(8);
        break;
      case 2:
        this.skip(this.uint32());
        break;
      case 5:
        this.skip(4);
        break;
    }
  }

  int32(): number {
    return this.uint32() | 0;
  }

  int64(): bigint {
    const v = this.uint64();
    return v >> big63 === big0 ? v : -((~v + big1) & bigmaxi64);
  }

  uint32(): number {
    let v = (this.buf[this.pos] & 127) >>> 0;
    if (this.buf[this.pos++] < 128) return v;
    v = (v | ((this.buf[this.pos] & 127) << 7)) >>> 0;
    if (this.buf[this.pos++] < 128) return v;
    v = (v | ((this.buf[this.pos] & 127) << 14)) >>> 0;
    if (this.buf[this.pos++] < 128) return v;
    v = (v | ((this.buf[this.pos] & 127) << 21)) >>> 0;
    if (this.buf[this.pos++] < 128) return v;
    v = (v | ((this.buf[this.pos] & 15) << 28)) >>> 0;
    return v >>> 0;
  }

  uint64(): bigint {
    let lo = (this.buf[this.pos] & 127) >>> 0;
    if (this.buf[this.pos++] < 128) return BigInt(lo);
    lo = (lo | ((this.buf[this.pos] & 127) << 7)) >>> 0;
    if (this.buf[this.pos++] < 128) return BigInt(lo);
    lo = (lo | ((this.buf[this.pos] & 127) << 14)) >>> 0;
    if (this.buf[this.pos++] < 128) return BigInt(lo);
    lo = (lo | ((this.buf[this.pos] & 127) << 21)) >>> 0;
    if (this.buf[this.pos++] < 128) return BigInt(lo);
    lo = (lo | ((this.buf[this.pos] & 127) << 28)) >>> 0;

    let hi = ((this.buf[this.pos] & 127) >> 4) >>> 0;
    if (this.buf[this.pos++] < 128) return (BigInt(hi) << big32) | BigInt(lo);
    hi = (hi | ((this.buf[this.pos] & 127) << 3)) >>> 0;
    if (this.buf[this.pos++] < 128) return (BigInt(hi) << big32) | BigInt(lo);
    hi = (hi | ((this.buf[this.pos] & 127) << 10)) >>> 0;
    if (this.buf[this.pos++] < 128) return (BigInt(hi) << big32) | BigInt(lo);
    hi = (hi | ((this.buf[this.pos] & 127) << 17)) >>> 0;
    if (this.buf[this.pos++] < 128) return (BigInt(hi) << big32) | BigInt(lo);
    hi = (hi | ((this.buf[this.pos] & 127) << 24)) >>> 0;
    if (this.buf[this.pos++] < 128) return (BigInt(hi) << big32) | BigInt(lo);
    hi = (hi | ((this.buf[this.pos] & 127) << 31)) >>> 0;
    this.pos++;
    return (BigInt(hi) << big32) | BigInt(lo);
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
    const lo = BigInt(this.fixed32());
    const hi = BigInt(this.fixed32());
    return (hi << big32) | lo;
  }

  sfixed64(): bigint {
    const lo = BigInt(this.fixed32());
    const hi = BigInt(this.sfixed32());
    return (hi << big32) | lo;
  }

  double(): number {
    const v = readFloat64(this.buf, this.pos);
    this.pos += 8;
    return v;
  }

  string(): string {
    const decoder = new TextDecoder();
    return decoder.decode(this.bytes());
  }

  bytes(): Uint8Array {
    const len = this.uint32();
    const v = this.buf.slice(this.pos, this.pos + len);
    this.pos += len;
    return v;
  }

  fixed32(): number {
    return this.sfixed32() >>> 0;
  }

  sfixed32(): number {
    this.pos += 4;
    return (
      this.buf[this.pos - 4] |
      (this.buf[this.pos - 3] << 8) |
      (this.buf[this.pos - 2] << 16) |
      (this.buf[this.pos - 1] << 24)
    );
  }

  float(): number {
    const v = readFloat32(this.buf, this.pos);
    this.pos += 4;
    return v;
  }
}
