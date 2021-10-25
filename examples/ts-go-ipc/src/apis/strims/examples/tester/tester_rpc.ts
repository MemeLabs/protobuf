import strims_rpc_Host, { UnaryCallOptions as strims_rpc_UnaryCallOptions } from "@memelabs/protobuf/lib/rpc/host";
import strims_rpc_Service from "@memelabs/protobuf/lib/rpc/service";
import { Call as strims_rpc_Call } from "@memelabs/protobuf/lib/apis/strims/rpc/rpc";
import { Readable as GenericReadable } from "@memelabs/protobuf/lib/rpc/stream";

import {
  IUnaryRequest,
  UnaryRequest,
  UnaryResponse,
  IStreamRequest,
  StreamRequest,
  StreamResponse,
} from "./tester";

export interface TesterService {
  unary(req: UnaryRequest, call: strims_rpc_Call): Promise<UnaryResponse> | UnaryResponse;
  stream(req: StreamRequest, call: strims_rpc_Call): GenericReadable<StreamResponse>;
}

export const registerTesterService = (host: strims_rpc_Service, service: TesterService): void => {
  host.registerMethod<UnaryRequest, UnaryResponse>("strims.examples.tester.Tester.Unary", service.unary.bind(service), UnaryRequest);
  host.registerMethod<StreamRequest, StreamResponse>("strims.examples.tester.Tester.Stream", service.stream.bind(service), StreamRequest);
}

export class TesterClient {
  constructor(private readonly host: strims_rpc_Host) {}

  public unary(req?: IUnaryRequest, opts?: strims_rpc_UnaryCallOptions): Promise<UnaryResponse> {
    return this.host.expectOne(this.host.call("strims.examples.tester.Tester.Unary", new UnaryRequest(req)), UnaryResponse, opts);
  }

  public stream(req?: IStreamRequest): GenericReadable<StreamResponse> {
    return this.host.expectMany(this.host.call("strims.examples.tester.Tester.Stream", new StreamRequest(req)), StreamResponse);
  }
}

