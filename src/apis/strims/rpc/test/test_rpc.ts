import { RPCHost } from "../../../../rpc/host";
import { registerType } from "../../../../rpc/registry";
import { Readable as GenericReadable } from "../../../../rpc/stream";

import {
  IRPCCallUnaryRequest,
  RPCCallUnaryRequest,
  RPCCallUnaryResponse,
  IRPCCallStreamRequest,
  RPCCallStreamRequest,
  RPCCallStreamResponse,
} from "./test";

registerType("strims.rpc.test.RPCCallUnaryRequest", RPCCallUnaryRequest);
registerType("strims.rpc.test.RPCCallUnaryResponse", RPCCallUnaryResponse);
registerType("strims.rpc.test.RPCCallStreamRequest", RPCCallStreamRequest);
registerType("strims.rpc.test.RPCCallStreamResponse", RPCCallStreamResponse);

export class RPCTestClient {
  constructor(private readonly host: RPCHost) {}

  public callUnary(arg: IRPCCallUnaryRequest = new RPCCallUnaryRequest()): Promise<RPCCallUnaryResponse> {
    return this.host.expectOne(this.host.call("strims.rpc.test.RPCTest.CallUnary", new RPCCallUnaryRequest(arg)));
  }

  public callStream(arg: IRPCCallStreamRequest = new RPCCallStreamRequest()): GenericReadable<RPCCallStreamResponse> {
    return this.host.expectMany(this.host.call("strims.rpc.test.RPCTest.CallStream", new RPCCallStreamRequest(arg)));
  }
}

