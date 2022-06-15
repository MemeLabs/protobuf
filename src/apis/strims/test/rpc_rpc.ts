import strims_rpc_Host, { UnaryCallOptions as strims_rpc_UnaryCallOptions } from "../../../rpc/host";
import strims_rpc_Service from "../../../rpc/service";
import { Call as strims_rpc_Call } from "../../../apis/strims/rpc/rpc";
import { Readable as GenericReadable } from "../../../rpc/stream";

import {
  IRPCCallUnaryRequest,
  RPCCallUnaryRequest,
  RPCCallUnaryResponse,
  IRPCCallStreamRequest,
  RPCCallStreamRequest,
  RPCCallStreamResponse,
} from "./rpc";

export interface RPCTestService {
  callUnary(req: RPCCallUnaryRequest, call: strims_rpc_Call): Promise<RPCCallUnaryResponse> | RPCCallUnaryResponse;
  callStream(req: RPCCallStreamRequest, call: strims_rpc_Call): GenericReadable<RPCCallStreamResponse>;
}

export class UnimplementedRPCTestService implements RPCTestService {
  callUnary(req: RPCCallUnaryRequest, call: strims_rpc_Call): Promise<RPCCallUnaryResponse> | RPCCallUnaryResponse { throw new Error("not implemented"); }
  callStream(req: RPCCallStreamRequest, call: strims_rpc_Call): GenericReadable<RPCCallStreamResponse> { throw new Error("not implemented"); }
}

export const registerRPCTestService = (host: strims_rpc_Service, service: RPCTestService): void => {
  host.registerMethod<RPCCallUnaryRequest, RPCCallUnaryResponse>("strims.test.RPCTest.CallUnary", service.callUnary.bind(service), RPCCallUnaryRequest);
  host.registerMethod<RPCCallStreamRequest, RPCCallStreamResponse>("strims.test.RPCTest.CallStream", service.callStream.bind(service), RPCCallStreamRequest);
}

export class RPCTestClient {
  constructor(private readonly host: strims_rpc_Host) {}

  public callUnary(req?: IRPCCallUnaryRequest, opts?: strims_rpc_UnaryCallOptions): Promise<RPCCallUnaryResponse> {
    return this.host.expectOne(this.host.call("strims.test.RPCTest.CallUnary", new RPCCallUnaryRequest(req)), RPCCallUnaryResponse, opts);
  }

  public callStream(req?: IRPCCallStreamRequest): GenericReadable<RPCCallStreamResponse> {
    return this.host.expectMany(this.host.call("strims.test.RPCTest.CallStream", new RPCCallStreamRequest(req)), RPCCallStreamResponse);
  }
}

