import strims_rpc_Host, { UnaryCallOptions as strims_rpc_UnaryCallOptions } from "@memelabs/protobuf/lib/rpc/host";
import strims_rpc_Service from "@memelabs/protobuf/lib/rpc/service";
import { Call as strims_rpc_Call } from "@memelabs/protobuf/lib/apis/strims/rpc/rpc";

import {
  strims_examples_greeter_IGreetRequest,
  strims_examples_greeter_GreetRequest,
  strims_examples_greeter_GreetResponse,
} from "./greeter";

export interface GreeterService {
  greet(req: strims_examples_greeter_GreetRequest, call: strims_rpc_Call): Promise<strims_examples_greeter_GreetResponse> | strims_examples_greeter_GreetResponse;
}

export class UnimplementedGreeterService implements GreeterService {
  greet(req: strims_examples_greeter_GreetRequest, call: strims_rpc_Call): Promise<strims_examples_greeter_GreetResponse> | strims_examples_greeter_GreetResponse { throw new Error("not implemented"); }
}

export const registerGreeterService = (host: strims_rpc_Service, service: GreeterService): void => {
  host.registerMethod<strims_examples_greeter_GreetRequest, strims_examples_greeter_GreetResponse>("strims.examples.greeter.Greeter.Greet", service.greet.bind(service), strims_examples_greeter_GreetRequest);
}

export class GreeterClient {
  constructor(private readonly host: strims_rpc_Host) {}

  public greet(req?: strims_examples_greeter_IGreetRequest, opts?: strims_rpc_UnaryCallOptions): Promise<strims_examples_greeter_GreetResponse> {
    return this.host.expectOne(this.host.call("strims.examples.greeter.Greeter.Greet", new strims_examples_greeter_GreetRequest(req)), strims_examples_greeter_GreetResponse, opts);
  }
}

