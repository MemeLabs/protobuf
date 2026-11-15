import Reader from "../../../../pb/reader";
import Writer from "../../../../pb/writer";


export type IFoo = object;

export class Foo {

  constructor(v?: IFoo) {
    void v; // an empty message has no fields to set
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
  pkgFoo?: IFoo;
  pkgBarFoo?: Bar_IFoo;
}

export class Bar {
  pkgFoo: Foo | undefined;
  pkgBarFoo: Bar_Foo | undefined;

  constructor(v?: IBar) {
    this.pkgFoo = v?.pkgFoo && new Foo(v.pkgFoo);
    this.pkgBarFoo = v?.pkgBarFoo && new Bar_Foo(v.pkgBarFoo);
  }

  static encode(m: Bar, w?: Writer): Writer {
    if (!w) w = new Writer();
    if (m.pkgFoo) Foo.encode(m.pkgFoo, w.uint32(10).fork()).ldelim();
    if (m.pkgBarFoo) Bar_Foo.encode(m.pkgBarFoo, w.uint32(18).fork()).ldelim();
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
        m.pkgFoo = Foo.decode(r, r.uint32());
        break;
        case 2:
        m.pkgBarFoo = Bar_Foo.decode(r, r.uint32());
        break;
        default:
        r.skipType(tag & 7);
        break;
      }
    }
    return m;
  }
}

export type Bar_IFoo = {
  pkgFoo?: IFoo;
  pkgBarFoo2?: Bar_IFoo;
}

export class Bar_Foo {
  pkgFoo: Foo | undefined;
  pkgBarFoo2: Bar_Foo | undefined;

  constructor(v?: Bar_IFoo) {
    this.pkgFoo = v?.pkgFoo && new Foo(v.pkgFoo);
    this.pkgBarFoo2 = v?.pkgBarFoo2 && new Bar_Foo(v.pkgBarFoo2);
  }

  static encode(m: Bar_Foo, w?: Writer): Writer {
    if (!w) w = new Writer();
    if (m.pkgFoo) Foo.encode(m.pkgFoo, w.uint32(10).fork()).ldelim();
    if (m.pkgBarFoo2) Bar_Foo.encode(m.pkgBarFoo2, w.uint32(18).fork()).ldelim();
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): Bar_Foo {
    r = r instanceof Reader ? r : new Reader(r);
    const end = length === undefined ? r.len : r.pos + length;
    const m = new Bar_Foo();
    while (r.pos < end) {
      const tag = r.uint32();
      switch (tag >> 3) {
        case 1:
        m.pkgFoo = Foo.decode(r, r.uint32());
        break;
        case 2:
        m.pkgBarFoo2 = Bar_Foo.decode(r, r.uint32());
        break;
        default:
        r.skipType(tag & 7);
        break;
      }
    }
    return m;
  }
}

export type Bar_Foo_IBar = {
  pkgFoo?: IFoo;
  pkgBarFoo?: Bar_IFoo;
  pkgBarFoo2?: Bar_IFoo;
  pkgBarFooBar?: Bar_Foo_IBar;
  pkgBarFooBar2?: Bar_Foo_IBar;
}

export class Bar_Foo_Bar {
  pkgFoo: Foo | undefined;
  pkgBarFoo: Bar_Foo | undefined;
  pkgBarFoo2: Bar_Foo | undefined;
  pkgBarFooBar: Bar_Foo_Bar | undefined;
  pkgBarFooBar2: Bar_Foo_Bar | undefined;

  constructor(v?: Bar_Foo_IBar) {
    this.pkgFoo = v?.pkgFoo && new Foo(v.pkgFoo);
    this.pkgBarFoo = v?.pkgBarFoo && new Bar_Foo(v.pkgBarFoo);
    this.pkgBarFoo2 = v?.pkgBarFoo2 && new Bar_Foo(v.pkgBarFoo2);
    this.pkgBarFooBar = v?.pkgBarFooBar && new Bar_Foo_Bar(v.pkgBarFooBar);
    this.pkgBarFooBar2 = v?.pkgBarFooBar2 && new Bar_Foo_Bar(v.pkgBarFooBar2);
  }

  static encode(m: Bar_Foo_Bar, w?: Writer): Writer {
    if (!w) w = new Writer();
    if (m.pkgFoo) Foo.encode(m.pkgFoo, w.uint32(10).fork()).ldelim();
    if (m.pkgBarFoo) Bar_Foo.encode(m.pkgBarFoo, w.uint32(18).fork()).ldelim();
    if (m.pkgBarFoo2) Bar_Foo.encode(m.pkgBarFoo2, w.uint32(26).fork()).ldelim();
    if (m.pkgBarFooBar) Bar_Foo_Bar.encode(m.pkgBarFooBar, w.uint32(34).fork()).ldelim();
    if (m.pkgBarFooBar2) Bar_Foo_Bar.encode(m.pkgBarFooBar2, w.uint32(42).fork()).ldelim();
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): Bar_Foo_Bar {
    r = r instanceof Reader ? r : new Reader(r);
    const end = length === undefined ? r.len : r.pos + length;
    const m = new Bar_Foo_Bar();
    while (r.pos < end) {
      const tag = r.uint32();
      switch (tag >> 3) {
        case 1:
        m.pkgFoo = Foo.decode(r, r.uint32());
        break;
        case 2:
        m.pkgBarFoo = Bar_Foo.decode(r, r.uint32());
        break;
        case 3:
        m.pkgBarFoo2 = Bar_Foo.decode(r, r.uint32());
        break;
        case 4:
        m.pkgBarFooBar = Bar_Foo_Bar.decode(r, r.uint32());
        break;
        case 5:
        m.pkgBarFooBar2 = Bar_Foo_Bar.decode(r, r.uint32());
        break;
        default:
        r.skipType(tag & 7);
        break;
      }
    }
    return m;
  }
}

