import { big1, big127, big128, big32, big63, big7, bigmaxu32 } from "./big";
import { writeFloat32, writeFloat64 } from "./float";

const maxVarintLen32 = 5;
const growthFactor = 1.5;

export default class Writer {
  buf: Uint8Array;
  pos = 0;
  offsets: number[];

  constructor(size = 1024) {
    this.buf = new Uint8Array(size);
    this.offsets = [];
  }

  private grow(n: number) {
    if (this.buf.length > this.pos + n) {
      return;
    }

    let l = this.buf.length;
    while (l < this.pos + n) {
      l *= growthFactor;
    }

    const src = this.buf;
    this.buf = new Uint8Array(l);
    this.buf.set(src);
  }

  reset(): Writer {
    this.pos = 0;
    return this;
  }

  fork(): Writer {
    this.offsets.push(this.pos);
    this.pos += maxVarintLen32;
    return this;
  }

  ldelim(): Writer {
    const pos = this.offsets.pop();
    const len = this.pos - pos - maxVarintLen32;

    this.pos = pos;
    this.uint32(len);
    this.buf.copyWithin(this.pos, pos + maxVarintLen32, pos + maxVarintLen32 + len);
    this.pos += len;

    return this;
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }

  int32(v: number): Writer {
    return this.uint32(v >>> 0);
  }

  int64(v: bigint): Writer {
    if (v < 0) {
      v += big1 << BigInt(64);
    }
    return this.uint64(v);
  }

  uint32(v: number): Writer {
    this.grow(4);
    while (v >= 0x80) {
      this.buf[this.pos] = Number(v & 0x7f) | 0x80;
      v >>>= 7;
      this.pos++;
    }
    this.buf[this.pos] = Number(v & 0x7f);
    this.pos++;
    return this;
  }

  uint64(v: bigint): Writer {
    this.grow(8);
    while (v >= big128) {
      this.buf[this.pos] = Number(v & big127) | 0x80;
      v >>= big7;
      this.pos++;
    }
    this.buf[this.pos] = Number(v & big127);
    this.pos++;
    return this;
  }

  sint32(v: number): Writer {
    return this.uint32(((v << 1) ^ (v >> 31)) >>> 0);
  }

  sint64(v: bigint): Writer {
    return this.uint64((v << big1) ^ (v >> big63));
  }

  bool(v: boolean): Writer {
    return this.uint32(v ? 1 : 0);
  }

  enum(v: number): Writer {
    return this.uint32(v);
  }

  fixed64(v: bigint): Writer {
    this.fixed32(Number(v & bigmaxu32));
    this.fixed32(Number((v >> big32) & bigmaxu32));
    return this;
  }

  sfixed64(v: bigint): Writer {
    return this.fixed64(v);
  }

  double(v: number): Writer {
    this.grow(8);
    writeFloat64(this.buf, this.pos, v);
    this.pos += 8;
    return this;
  }

  string(v: string): Writer {
    const encoder = new TextEncoder();
    return this.bytes(encoder.encode(v));
  }

  bytes(v: Uint8Array): Writer {
    this.grow(4 + v.byteLength);
    this.uint32(v.byteLength);
    this.buf.set(v, this.pos);
    this.pos += v.byteLength;
    return this;
  }

  fixed32(v: number): Writer {
    return this.sfixed32(v);
  }

  sfixed32(v: number): Writer {
    this.grow(4);
    this.pos += 4;
    this.buf[this.pos - 4] = v & 0xff;
    this.buf[this.pos - 3] = (v >> 8) & 0xff;
    this.buf[this.pos - 2] = (v >> 16) & 0xff;
    this.buf[this.pos - 1] = (v >> 24) & 0xff;
    return this;
  }

  float(v: number): Writer {
    this.grow(4);
    writeFloat32(this.buf, this.pos, v);
    this.pos += 4;
    return this;
  }
}
