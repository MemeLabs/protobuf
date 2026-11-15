import type { default as strims_rpc_Host, UnaryCallOptions as strims_rpc_UnaryCallOptions } from "../../../rpc/host";
import type strims_rpc_Service from "../../../rpc/service";
import type { Call as strims_rpc_Call } from "../../../apis/strims/rpc/rpc";
import type { Readable as GenericReadable } from "../../../rpc/stream";

import {
  type IRPCCallUnaryRequest as strims_test_IRPCCallUnaryRequest,
  RPCCallUnaryRequest as strims_test_RPCCallUnaryRequest,
  RPCCallUnaryResponse as strims_test_RPCCallUnaryResponse,
  type IRPCCallStreamRequest as strims_test_IRPCCallStreamRequest,
  RPCCallStreamRequest as strims_test_RPCCallStreamRequest,
  RPCCallStreamResponse as strims_test_RPCCallStreamResponse,
} from "./rpc";

export interface RPCTestService {
  callUnary(req: strims_test_RPCCallUnaryRequest, call: strims_rpc_Call): Promise<strims_test_RPCCallUnaryResponse> | strims_test_RPCCallUnaryResponse;
  callStream(req: strims_test_RPCCallStreamRequest, call: strims_rpc_Call): GenericReadable<strims_test_RPCCallStreamResponse>;
}

export class UnimplementedRPCTestService implements RPCTestService {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  callUnary(req: strims_test_RPCCallUnaryRequest, call: strims_rpc_Call): Promise<strims_test_RPCCallUnaryResponse> | strims_test_RPCCallUnaryResponse { throw new Error("not implemented"); }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  callStream(req: strims_test_RPCCallStreamRequest, call: strims_rpc_Call): GenericReadable<strims_test_RPCCallStreamResponse> { throw new Error("not implemented"); }
}

export const registerRPCTestService = (host: strims_rpc_Service, service: RPCTestService): void => {
  host.registerMethod<strims_test_RPCCallUnaryRequest, strims_test_RPCCallUnaryResponse>("strims.test.RPCTest.CallUnary", (req, call) => service.callUnary(req, call), strims_test_RPCCallUnaryRequest);
  host.registerMethod<strims_test_RPCCallStreamRequest, strims_test_RPCCallStreamResponse>("strims.test.RPCTest.CallStream", (req, call) => service.callStream(req, call), strims_test_RPCCallStreamRequest);
}

export class RPCTestClient {
  constructor(private readonly host: strims_rpc_Host) {}

  public callUnary(req?: strims_test_IRPCCallUnaryRequest, opts?: strims_rpc_UnaryCallOptions): Promise<strims_test_RPCCallUnaryResponse> {
    return this.host.expectOne(this.host.call("strims.test.RPCTest.CallUnary", new strims_test_RPCCallUnaryRequest(req)), strims_test_RPCCallUnaryResponse, opts);
  }

  public callStream(req?: strims_test_IRPCCallStreamRequest): GenericReadable<strims_test_RPCCallStreamResponse> {
    return this.host.expectMany(this.host.call("strims.test.RPCTest.CallStream", new strims_test_RPCCallStreamRequest(req)), strims_test_RPCCallStreamResponse);
  }
}

