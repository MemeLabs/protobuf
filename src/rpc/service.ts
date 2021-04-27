import { Call } from "../apis/strims/rpc/rpc";
import { Readable as GenericReadable } from "./stream";

export type Method<Request, Response> = (
  arg: Request,
  call?: Call
) => Response | Promise<Response> | GenericReadable<Response> | undefined;

export default class ServiceRegistry {
  methods: {
    [key: string]: Method<unknown, unknown>;
  };

  constructor() {
    this.methods = {};
  }

  public registerMethod<Request, Response>(name: string, method: Method<Request, Response>): void {
    this.methods[name] = method;
  }
}
