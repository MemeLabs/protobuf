import { Call } from "../apis/strims/rpc/rpc.pb";
import { MessageClass } from "../pb/message";
import { Readable as GenericReadable } from "./stream";

// A method's handler. It returns, or resolves to, the response: a message, a
// Readable of messages, an rpc.Error, or undefined. A throw, rejection or
// stream error is sent as an rpc.Error with its message and code. If the call
// is cancelled or the connection closes, nothing more is sent and a returned
// Readable is destroyed without an error. A request over one of the host's
// limits (see HostOptions) is refused without calling the handler.
export type Callback<Request, Response> = (
  arg: Request,
  call: Call
) => Response | Promise<Response> | GenericReadable<Response> | undefined;

export interface Method<Request, Response> {
  // a method, whose parameters are bivariant, so a Method<Request, Response>
  // is a Method<unknown, unknown>
  callback(arg: Request, call: Call): ReturnType<Callback<Request, Response>>;
  reqType: MessageClass<Request>;
}

export default class ServiceRegistry {
  methods: {
    [key: string]: Method<unknown, unknown>;
  };

  constructor() {
    this.methods = {};
  }

  public registerMethod<Request, Response>(
    name: string,
    callback: Callback<Request, Response>,
    reqType: MessageClass<Request>
  ): void {
    this.methods[name] = { callback, reqType };
  }
}
