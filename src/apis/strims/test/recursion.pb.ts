import Reader from "../../../pb/reader";
import Writer from "../../../pb/writer";


/**
 * Nests through map values, for the TS recursion limit's tests. Only its TS
 * bindings are generated.
 */
export type IMapNode = {
  children?: Map<string, IMapNode> | { [key: string]: IMapNode };
  values?: Map<number, number> | { [key: number]: number };
}

/**
 * Nests through map values, for the TS recursion limit's tests. Only its TS
 * bindings are generated.
 */
export class MapNode {
  children: Map<string, MapNode>;
  values: Map<number, number>;

  constructor(v?: IMapNode) {
    if (v?.children) this.children = new Map(v.children instanceof Map ? Array.from(v.children).map(([k, v]) => [k, new MapNode(v)]) : Object.entries(v.children).map(([k, v]) => [String(k), new MapNode(v)]));
    else this.children = new Map<string, MapNode>();
    if (v?.values) this.values = new Map(v.values instanceof Map ? v.values : Object.entries(v.values).map(([k, v]) => [Number(k), v]));
    else this.values = new Map<number, number>();
  }

  static encode(m: MapNode, w?: Writer): Writer {
    if (!w) w = new Writer();
    for (const [k, v] of m.children) MapNode.encode(v, w.uint32(10).fork().uint32(10).string(k).uint32(18).fork()).ldelim().ldelim();
    for (const [k, v] of m.values) w.uint32(18).fork().uint32(8).int32(k).uint32(16).int32(v).ldelim();
    return w;
  }

  static decode(r: Reader | Uint8Array, length?: number): MapNode {
    r = r instanceof Reader ? r : new Reader(r);
    const parentEnd = r.enter(length);
    const end = r.end;
    const m = new MapNode();
    while (r.pos < end) {
      const tag = r.uint32();
      switch (tag >> 3) {
        case 1:
        {
          const entryParentEnd = r.enter(r.uint32());
          const fend = r.end;
          let key: string = "";
          let value: MapNode | undefined;
          while (r.pos < fend) {
            const ftag = r.uint32();
            switch (ftag >> 3) {
              case 1:
              key = r.string();
              break;
              case 2:
              value = MapNode.decode(r, r.uint32());
              break;
              default:
              r.skipType(ftag & 7, ftag >>> 3);
              break;
            }
          }
          r.leave(entryParentEnd);
          m.children.set(key, value ?? new MapNode());
        }
        break;
        case 2:
        {
          const entryParentEnd = r.enter(r.uint32());
          const fend = r.end;
          let key: number = 0;
          let value: number = 0;
          while (r.pos < fend) {
            const ftag = r.uint32();
            switch (ftag >> 3) {
              case 1:
              key = r.int32();
              break;
              case 2:
              value = r.int32();
              break;
              default:
              r.skipType(ftag & 7, ftag >>> 3);
              break;
            }
          }
          r.leave(entryParentEnd);
          m.values.set(key, value);
        }
        break;
        default:
        r.skipType(tag & 7, tag >>> 3);
        break;
      }
    }
    r.leave(parentEnd);
    return m;
  }
}

