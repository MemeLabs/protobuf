import { PassThrough, Readable, Writable } from "stream";

import { Call, Cancel, Close, Error, Undefined } from "../apis/strims/rpc/rpc";
import { Message, MessageClass } from "../pb/message";
import Reader from "../pb/reader";
import Writer from "../pb/writer";
import ServiceRegistry from "./service";
import { Readable as GenericReadable } from "./stream";

const CALL_TIMEOUT_MS = 5000;

type CallbackHandler = (m: unknown) => void;

export interface UnaryCallOptions {
  timeout?: number;
}

export default class Host {
  private w: Writable;
  private service: ServiceRegistry | undefined;
  private callId: bigint;
  private callbacks: Map<bigint, CallbackHandler>;
  private argWriter: Writer;
  private callWriter: Writer;

  constructor(w: Writable, r: Readable, service?: ServiceRegistry) {
    this.w = w;
    this.service = service;
    this.callId = BigInt(0);
    this.callbacks = new Map<bigint, CallbackHandler>();
    this.argWriter = new Writer();
    this.callWriter = new Writer();

    r.on("data", this.handleData.bind(this));
  }

  public call(
    method: string,
    arg: unknown,
    kind: Call.Kind = Call.Kind.CALL_KIND_DEFAULT,
    parentId = BigInt(0)
  ): Call {
    const call = new Call({
      id: ++this.callId,
      parentId,
      method,
      kind,
      argument: (arg as Message<unknown>).constructor.encode(arg, this.argWriter.reset()).finish(),
    });

    this.w.write(Call.encode(call, this.callWriter.reset().fork()).ldelim().finish().slice());

    return call;
  }

  public expectOne<T>(
    call: Call,
    Message: MessageClass<T>,
    { timeout }: UnaryCallOptions = {}
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const tid = setTimeout(() => {
        reject();
        this.callbacks.delete(call.id);
      }, timeout || CALL_TIMEOUT_MS);

      this.callbacks.set(call.id, (res: Call) => {
        clearTimeout(tid);
        this.callbacks.delete(call.id);

        switch (res.kind) {
          case Call.Kind.CALL_KIND_DEFAULT:
            resolve(Message.decode(res.argument));
            break;
          case Call.Kind.CALL_KIND_ERROR:
            reject(Error.decode(res.argument));
            break;
        }
      });
    });
  }

  public expectMany<T>(call: Call, Message: MessageClass<T>): GenericReadable<T> {
    const e = new PassThrough({
      objectMode: true,
    });

    const handleClose = () => {
      this.call("CANCEL", new Cancel(), Call.Kind.CALL_KIND_CANCEL, call.id);
    };
    e.on("close", handleClose);

    this.callbacks.set(call.id, (res: Call) => {
      switch (res.kind) {
        case Call.Kind.CALL_KIND_DEFAULT:
          e.push(Message.decode(res.argument));
          break;
        case Call.Kind.CALL_KIND_ERROR:
          e.emit("error", Error.decode(res.argument));
          break;
        case Call.Kind.CALL_KIND_CLOSE:
          this.callbacks.delete(call.id);
          e.off("close", handleClose);
          e.end();
          break;
      }
    });

    return (e as unknown) as GenericReadable<T>;
  }

  private handleData(data: ArrayBuffer) {
    const reader = new Reader(new Uint8Array(data));
    while (reader.pos < reader.len) {
      const call = Call.decode(reader, reader.uint32());
      if (call.parentId) {
        this.callbacks.get(call.parentId)?.(call);
      } else {
        this.handleCall(call);
      }
    }
  }

  private handleCall(call: Call) {
    let res: unknown;
    const method = this.service?.methods[call.method];
    if (method) {
      try {
        res = method.callback(method.reqType.decode(call.argument), call);
      } catch ({ message, code }) {
        res = new Error({
          message: String(message),
          code: code >>> 0,
        });
      }
    } else {
      res = new Error({ message: `method not implemented: ${call.method}` });
    }

    if (res instanceof Readable) {
      res.on("data", (v) => this.call("CALLBACK", v, Call.Kind.CALL_KIND_DEFAULT, call.id));
      res.on("close", () => this.call("CALLBACK", new Close(), Call.Kind.CALL_KIND_CLOSE, call.id));
    } else if (res instanceof Promise) {
      void res.then((v) => this.call("CALLBACK", v, Call.Kind.CALL_KIND_DEFAULT, call.id));
      res.catch(({ message, code }) => {
        const e = new Error({
          message: String(message),
          code: code >>> 0,
        });
        this.call("CALLBACK", e, Call.Kind.CALL_KIND_ERROR, call.id);
      });
    } else if (res instanceof Error) {
      this.call("CALLBACK", res, Call.Kind.CALL_KIND_ERROR, call.id);
    } else if (res === undefined) {
      this.call("CALLBACK", new Undefined(), Call.Kind.CALL_KIND_UNDEFINED, call.id);
    } else {
      this.call("CALLBACK", res, Call.Kind.CALL_KIND_DEFAULT, call.id);
    }
  }
}
