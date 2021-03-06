import strims_rpc_Host, { UnaryCallOptions as strims_rpc_UnaryCallOptions } from "@memelabs/protobuf/lib/rpc/host";
import strims_rpc_Service from "@memelabs/protobuf/lib/rpc/service";
import { registerType } from "@memelabs/protobuf/lib/rpc/registry";
import { Call as strims_rpc_Call } from "@memelabs/protobuf/lib/apis/strims/rpc/rpc";

import {
  IGreetRequest,
  GreetRequest,
  GreetResponse,
} from "./greeter";

registerType("strims.examples.greeter.GreetRequest", GreetRequest);
registerType("strims.examples.greeter.GreetResponse", GreetResponse);

export interface GreeterService {
  greet(req: GreetRequest, call: strims_rpc_Call): Promise<GreetResponse> | GreetResponse;
}

export const registerGreeterService = (host: strims_rpc_Service, service: GreeterService): void => {
  host.registerMethod<GreetRequest, GreetResponse>("strims.examples.greeter.Greeter.Greet", service.greet.bind(service));
}

export class GreeterClient {
  constructor(private readonly host: strims_rpc_Host) {}

  public greet(req?: IGreetRequest, opts?: strims_rpc_UnaryCallOptions): Promise<GreetResponse> {
    return this.host.expectOne(this.host.call("strims.examples.greeter.Greeter.Greet", new GreetRequest(req)), opts);
  }
}

