import { big1, big32, big63, bigmsb64 } from "./big";
import { writeFloat32, writeFloat64 } from "./float";

const maxVarintLen32 = 5;
const growthFactor = 1.5;

const textEncoder = new TextEncoder();

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
    return this.buf.subarray(0, this.pos);
  }

  int32(v: number): Writer {
    return this.uint32(v >>> 0);
  }

  int64(v: bigint): Writer {
    if (v < 0) {
      v += bigmsb64;
    }
    return this.uint64(v);
  }

  uint32(v: number): Writer {
    this.grow(5);
    while (v >= 128) {
      this.buf[this.pos++] = (v & 127) | 128;
      v >>>= 7;
    }
    this.buf[this.pos++] = v & 127;
    return this;
  }

  uint64(v: bigint): Writer {
    let lo = Number(BigInt.asUintN(32, v));
    let hi = Number(v >> big32);

    if (hi === 0) {
      return this.uint32(lo);
    }

    this.grow(10);

    for (let i = 0; i < 4; i++) {
      this.buf[this.pos++] = (lo & 127) | 128;
      lo >>>= 7;
    }

    if (hi <= 7) {
      this.buf[this.pos++] = ((hi & 7) << 4) | lo;
      return this;
    }

    this.buf[this.pos++] = ((hi & 7) << 4) | lo | 128;
    hi >>>= 3;

    while (hi >= 128) {
      this.buf[this.pos++] = (hi & 127) | 128;
      hi >>>= 7;
    }
    this.buf[this.pos++] = hi & 127;
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
    this.fixed32(Number(BigInt.asUintN(32, v)));
    this.fixed32(Number(v >> big32));
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
    return this.bytes(textEncoder.encode(v));
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
    this.buf[this.pos - 4] = v & 255;
    this.buf[this.pos - 3] = (v >> 8) & 255;
    this.buf[this.pos - 2] = (v >> 16) & 255;
    this.buf[this.pos - 1] = (v >> 24) & 255;
    return this;
  }

  float(v: number): Writer {
    this.grow(4);
    writeFloat32(this.buf, this.pos, v);
    this.pos += 4;
    return this;
  }
}
