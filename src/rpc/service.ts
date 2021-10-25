import { Call } from "../apis/strims/rpc/rpc";
import { Message, MessageClass } from "../pb/message";
import { Readable as GenericReadable } from "./stream";

export type Callback<Request, Response> = (
  arg: Request,
  call?: Call
) => Response | Promise<Response> | GenericReadable<Response> | undefined;

export interface Method<Request, Response> {
  callback: Callback<Request, Response>;
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
    callback: Callback<Message<Request>, Message<Response>>,
    reqType: MessageClass<Request>
  ): void {
    this.methods[name] = { callback, reqType };
  }
}
