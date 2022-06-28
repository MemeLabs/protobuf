import Reader from "../../../../pb/reader";
import Writer from "../../../../pb/writer";


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
  pkgFoo?: strims_test_internal_IFoo;
  pkgBarFoo?: strims_test_internal_Bar_IFoo;
}

export class Bar {
  pkgFoo: strims_test_internal_Foo | undefined;
  pkgBarFoo: strims_test_internal_Bar_Foo | undefined;

  constructor(v?: IBar) {
    this.pkgFoo = v?.pkgFoo && new strims_test_internal_Foo(v.pkgFoo);
    this.pkgBarFoo = v?.pkgBarFoo && new strims_test_internal_Bar_Foo(v.pkgBarFoo);
  }

  static encode(m: Bar, w?: Writer): Writer {
    if (!w) w = new Writer();
    if (m.pkgFoo) strims_test_internal_Foo.encode(m.pkgFoo, w.uint32(10).fork()).ldelim();
    if (m.pkgBarFoo) strims_test_internal_Bar_Foo.encode(m.pkgBarFoo, w.uint32(18).fork()).ldelim();
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
        m.pkgFoo = strims_test_internal_Foo.decode(r, r.uint32());
        break;
        case 2:
        m.pkgBarFoo = strims_test_internal_Bar_Foo.decode(r, r.uint32());
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
    pkgFoo?: strims_test_internal_IFoo;
    pkgBarFoo2?: strims_test_internal_Bar_IFoo;
  }

  export class Foo {
    pkgFoo: strims_test_internal_Foo | undefined;
    pkgBarFoo2: strims_test_internal_Bar_Foo | undefined;

    constructor(v?: IFoo) {
      this.pkgFoo = v?.pkgFoo && new strims_test_internal_Foo(v.pkgFoo);
      this.pkgBarFoo2 = v?.pkgBarFoo2 && new strims_test_internal_Bar_Foo(v.pkgBarFoo2);
    }

    static encode(m: Foo, w?: Writer): Writer {
      if (!w) w = new Writer();
      if (m.pkgFoo) strims_test_internal_Foo.encode(m.pkgFoo, w.uint32(10).fork()).ldelim();
      if (m.pkgBarFoo2) strims_test_internal_Bar_Foo.encode(m.pkgBarFoo2, w.uint32(18).fork()).ldelim();
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
          m.pkgFoo = strims_test_internal_Foo.decode(r, r.uint32());
          break;
          case 2:
          m.pkgBarFoo2 = strims_test_internal_Bar_Foo.decode(r, r.uint32());
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
      pkgFoo?: strims_test_internal_IFoo;
      pkgBarFoo?: strims_test_internal_Bar_IFoo;
      pkgBarFoo2?: strims_test_internal_Bar_IFoo;
      pkgBarFooBar?: strims_test_internal_Bar_Foo_IBar;
      pkgBarFooBar2?: strims_test_internal_Bar_Foo_IBar;
    }

    export class Bar {
      pkgFoo: strims_test_internal_Foo | undefined;
      pkgBarFoo: strims_test_internal_Bar_Foo | undefined;
      pkgBarFoo2: strims_test_internal_Bar_Foo | undefined;
      pkgBarFooBar: strims_test_internal_Bar_Foo_Bar | undefined;
      pkgBarFooBar2: strims_test_internal_Bar_Foo_Bar | undefined;

      constructor(v?: IBar) {
        this.pkgFoo = v?.pkgFoo && new strims_test_internal_Foo(v.pkgFoo);
        this.pkgBarFoo = v?.pkgBarFoo && new strims_test_internal_Bar_Foo(v.pkgBarFoo);
        this.pkgBarFoo2 = v?.pkgBarFoo2 && new strims_test_internal_Bar_Foo(v.pkgBarFoo2);
        this.pkgBarFooBar = v?.pkgBarFooBar && new strims_test_internal_Bar_Foo_Bar(v.pkgBarFooBar);
        this.pkgBarFooBar2 = v?.pkgBarFooBar2 && new strims_test_internal_Bar_Foo_Bar(v.pkgBarFooBar2);
      }

      static encode(m: Bar, w?: Writer): Writer {
        if (!w) w = new Writer();
        if (m.pkgFoo) strims_test_internal_Foo.encode(m.pkgFoo, w.uint32(10).fork()).ldelim();
        if (m.pkgBarFoo) strims_test_internal_Bar_Foo.encode(m.pkgBarFoo, w.uint32(18).fork()).ldelim();
        if (m.pkgBarFoo2) strims_test_internal_Bar_Foo.encode(m.pkgBarFoo2, w.uint32(26).fork()).ldelim();
        if (m.pkgBarFooBar) strims_test_internal_Bar_Foo_Bar.encode(m.pkgBarFooBar, w.uint32(34).fork()).ldelim();
        if (m.pkgBarFooBar2) strims_test_internal_Bar_Foo_Bar.encode(m.pkgBarFooBar2, w.uint32(42).fork()).ldelim();
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
            m.pkgFoo = strims_test_internal_Foo.decode(r, r.uint32());
            break;
            case 2:
            m.pkgBarFoo = strims_test_internal_Bar_Foo.decode(r, r.uint32());
            break;
            case 3:
            m.pkgBarFoo2 = strims_test_internal_Bar_Foo.decode(r, r.uint32());
            break;
            case 4:
            m.pkgBarFooBar = strims_test_internal_Bar_Foo_Bar.decode(r, r.uint32());
            break;
            case 5:
            m.pkgBarFooBar2 = strims_test_internal_Bar_Foo_Bar.decode(r, r.uint32());
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
export const strims_test_internal_Foo = Foo;
/* @internal */
export type strims_test_internal_Foo = Foo;
/* @internal */
export type strims_test_internal_IFoo = IFoo;
/* @internal */
export const strims_test_internal_Bar = Bar;
/* @internal */
export type strims_test_internal_Bar = Bar;
/* @internal */
export type strims_test_internal_IBar = IBar;
/* @internal */
export const strims_test_internal_Bar_Foo = Bar.Foo;
/* @internal */
export type strims_test_internal_Bar_Foo = Bar.Foo;
/* @internal */
export type strims_test_internal_Bar_IFoo = Bar.IFoo;
/* @internal */
export const strims_test_internal_Bar_Foo_Bar = Bar.Foo.Bar;
/* @internal */
export type strims_test_internal_Bar_Foo_Bar = Bar.Foo.Bar;
/* @internal */
export type strims_test_internal_Bar_Foo_IBar = Bar.Foo.IBar;
