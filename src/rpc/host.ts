import { PassThrough, Readable, Writable } from "stream";

import { Any } from "../apis/google/protobuf/any";
import { Call, Cancel, Close, Error, Undefined } from "../apis/strims/rpc/rpc";
import { Message } from "../pb/message";
import Reader from "../pb/reader";
import Writer from "../pb/writer";
import { anyValueType, registerType, typeName } from "./registry";
import { Readable as GenericReadable } from "./stream";

registerType("strims.rpc.Cancel", Cancel);
registerType("strims.rpc.Close", Close);
registerType("strims.rpc.Error", Error);
registerType("strims.rpc.Undefined", Undefined);

const CALL_TIMEOUT_MS = 5000;

type CallbackHandler = (m: unknown) => void;

export type Service = {
  [key: string]: <Request, Response>(
    call: Call,
    arg: Request
  ) => Response | Promise<Response> | GenericReadable<Response> | undefined;
};

// RPCHost transport agnostic remote procedure utility using protobufs.
export class RPCHost {
  private w: Writable;
  private service: Service;
  private callId: bigint;
  private callbacks: Map<bigint, CallbackHandler>;
  private argWriter: Writer;
  private callWriter: Writer;

  constructor(w: Writable, r: Readable, service: Service = {}) {
    this.w = w;
    this.service = service;
    this.callId = BigInt(0);
    this.callbacks = new Map<bigint, CallbackHandler>();
    this.argWriter = new Writer();
    this.callWriter = new Writer();

    this.createHandler(r);
  }

  public call<T>(method: string, arg: T, parentId = BigInt(0)): Call {
    const ctor = ((arg as unknown) as Message<T>).constructor;
    const call = new Call({
      id: ++this.callId,
      parentId,
      method,
      argument: new Any({
        typeUrl: `strims.gg/${typeName(ctor)}`,
        value: ctor.encode(arg, this.argWriter.reset()).finish(),
      }),
    });

    this.w.write(Call.encode(call, this.callWriter.reset().fork()).ldelim().finish());

    return call;
  }

  public expectOne<T>(call: Call, { timeout }: { timeout?: number } = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const tid = setTimeout(() => {
        reject();
        this.callbacks.delete(call.id);
      }, timeout || CALL_TIMEOUT_MS);

      this.callbacks.set(call.id, (res: unknown) => {
        clearTimeout(tid);
        this.callbacks.delete(call.id);

        if (res instanceof Error) {
          reject(res);
        } else {
          resolve(res as T);
        }
      });
    });
  }

  public expectMany<T>(call: Call): GenericReadable<T> {
    const e = new PassThrough({
      objectMode: true,
    });

    e.on("close", () => this.call("CANCEL", new Cancel(), call.id));

    this.callbacks.set(call.id, (r: unknown) => {
      if (r instanceof Error) {
        this.callbacks.delete(call.id);
        e.emit("error", new Error({ message: r.message }));
      } else if (r instanceof Close) {
        this.callbacks.delete(call.id);
        e.push(null);
      } else {
        e.push(r);
      }
    });

    return (e as unknown) as GenericReadable<T>;
  }

  private createHandler(r: Readable) {
    r.on("data", (data: ArrayBuffer) => {
      const reader = new Reader(new Uint8Array(data));
      while (reader.pos < reader.len) {
        const call = Call.decode(reader, reader.uint32());
        const arg = anyValueType(call.argument).decode(call.argument.value);

        if (call.parentId) {
          this.handleCallback(call, arg);
        } else {
          this.handleCall(call, arg);
        }
      }
    });
  }

  private handleCallback(call: Call, arg: unknown) {
    const cb = this.callbacks.get(call.parentId);
    if (cb) {
      cb(arg);
    }
  }

  private handleCall(call: Call, arg: unknown) {
    let res: unknown;
    try {
      const h = this.service[call.method];
      if (!h) {
        throw new Error({ message: `method not implemented: ${call.method}` });
      }
      res = h(call, arg);
    } catch ({ message }) {
      res = new Error({ message: String(message) });
    }

    if (res instanceof Readable) {
      res.on("data", (d) => this.call("CALLBACK", d, call.id));
      res.on("close", () => this.call("CALLBACK", new Close(), call.id));
    } else if (res instanceof Promise) {
      void res.then((d) => this.call("CALLBACK", d, call.id));
      res.catch(({ message }) => {
        const e = new Error({ message: String(message) });
        this.call("CALLBACK", e, call.id);
      });
    } else if (res === undefined) {
      this.call("CALLBACK", new Undefined(), call.id);
    } else {
      this.call("CALLBACK", res, call.id);
    }
  }
}
