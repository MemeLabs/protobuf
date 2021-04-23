import { RPCHost } from "../../../rpc/host";
import { registerType } from "../../../rpc/registry";
import { Readable as GenericReadable } from "../../../rpc/stream";

import {
  IRPCCallUnaryRequest,
  RPCCallUnaryRequest,
  RPCCallUnaryResponse,
  IRPCCallStreamRequest,
  RPCCallStreamRequest,
  RPCCallStreamResponse,
} from "./rpc";

registerType("strims.test.RPCCallUnaryRequest", RPCCallUnaryRequest);
registerType("strims.test.RPCCallUnaryResponse", RPCCallUnaryResponse);
registerType("strims.test.RPCCallStreamRequest", RPCCallStreamRequest);
registerType("strims.test.RPCCallStreamResponse", RPCCallStreamResponse);

export class RPCTestClient {
  constructor(private readonly host: RPCHost) {}

  public callUnary(arg: IRPCCallUnaryRequest = new RPCCallUnaryRequest()): Promise<RPCCallUnaryResponse> {
    return this.host.expectOne(this.host.call("strims.test.RPCTest.CallUnary", new RPCCallUnaryRequest(arg)));
  }

  public callStream(arg: IRPCCallStreamRequest = new RPCCallStreamRequest()): GenericReadable<RPCCallStreamResponse> {
    return this.host.expectMany(this.host.call("strims.test.RPCTest.CallStream", new RPCCallStreamRequest(arg)));
  }
}

