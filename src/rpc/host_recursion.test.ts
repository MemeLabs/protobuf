import assert from "assert";
import { PassThrough } from "stream";

import { Call, Call_Kind, ICall, Error as RPCError } from "../apis/strims/rpc/rpc.pb";
import { Bar_Foo } from "../apis/strims/test/message.pb";
import Reader from "../pb/reader";
import Writer from "../pb/writer";
import Host from "./host";
import ServiceRegistry from "./service";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Resolves once cond() holds, checking after each timer turn; fails after ms.
const waitFor = async (cond: () => boolean, what: string, ms = 5000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    await sleep(1);
    if (cond()) return;
    if (Date.now() > deadline) throw new Error(`timed out after ${ms}ms waiting for ${what}`);
  }
};

// A chain of levels Bar_Foo messages, each holding the next as testBarFoo.
const chain = (levels: number): Uint8Array => {
  let b: Uint8Array = new Uint8Array();
  for (let i = 1; i < levels; i++) {
    b = new Writer()
      .uint32((2 << 3) | 2)
      .bytes(b)
      .finish()
      .slice();
  }
  return b;
};

const depth = (m: Bar_Foo): number => {
  let n = 1;
  for (; m.testBarFoo; m = m.testBarFoo) n++;
  return n;
};

// A host serving "deep", which records the depth of each Bar_Foo it takes,
// and the peer's side of its connection.
const connect = () => {
  const seen: number[] = [];
  const service = new ServiceRegistry();
  service.registerMethod(
    "deep",
    (req: Bar_Foo) => {
      seen.push(depth(req));
      return new Bar_Foo();
    },
    Bar_Foo
  );
  const w = new PassThrough();
  const r = new PassThrough();
  const out: Call[] = [];
  w.on("data", (b: Uint8Array) => {
    const reader = new Reader(b);
    while (reader.pos < reader.len) {
      out.push(Call.decode(reader, reader.uint32()));
    }
  });
  const host = new Host(w, r, service);
  const send = (c: ICall) =>
    r.write(Call.encode(new Call(c), new Writer().fork()).ldelim().finish().slice());
  return { host, out, send, seen };
};

describe("Host recursion limit", function () {
  it("answers a request nested past the limit with ERROR, and keeps serving", async function () {
    const { out, send, seen } = connect();
    send({ id: BigInt(1), method: "deep", argument: chain(101) });
    send({ id: BigInt(2), method: "deep", argument: chain(100) });
    send({ id: BigInt(3), method: "deep", argument: chain(1) });
    await waitFor(() => out.length >= 3, "the three replies");
    assert.deepStrictEqual(
      out.map((c) => [c.parentId, Call_Kind[c.kind]]),
      [
        [BigInt(1), "CALL_KIND_ERROR"],
        [BigInt(2), "CALL_KIND_DEFAULT"],
        [BigInt(3), "CALL_KIND_DEFAULT"],
      ]
    );
    assert.strictEqual(
      RPCError.decode(out[0].argument).message,
      "exceeded maximum recursion depth (limit 100)"
    );
    assert.deepStrictEqual(seen, [100, 1]);
  });

  it("rejects a call whose response is nested past the limit", async function () {
    const { host, send } = connect();
    const callback = (id: number, levels: number): ICall => ({
      id: BigInt(1000 + id),
      parentId: BigInt(id),
      method: "CALLBACK",
      kind: Call_Kind.CALL_KIND_DEFAULT,
      argument: chain(levels),
    });
    const deep = host.expectOne(host.call("m", new Bar_Foo()), Bar_Foo);
    const ok = host.expectOne(host.call("m", new Bar_Foo()), Bar_Foo);
    send(callback(1, 101));
    send(callback(2, 100));
    await assert.rejects(deep, /exceeded maximum recursion depth/);
    assert.strictEqual(depth(await ok), 100);
  });
});
