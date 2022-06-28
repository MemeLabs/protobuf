import strims_rpc_Host, { UnaryCallOptions as strims_rpc_UnaryCallOptions } from "@memelabs/protobuf/lib/rpc/host";
import strims_rpc_Service from "@memelabs/protobuf/lib/rpc/service";
import { Call as strims_rpc_Call } from "@memelabs/protobuf/lib/apis/strims/rpc/rpc";
import { Readable as GenericReadable } from "@memelabs/protobuf/lib/rpc/stream";

import {
  strims_examples_tester_IUnaryRequest,
  strims_examples_tester_UnaryRequest,
  strims_examples_tester_UnaryResponse,
  strims_examples_tester_IStreamRequest,
  strims_examples_tester_StreamRequest,
  strims_examples_tester_StreamResponse,
} from "./tester";

export interface TesterService {
  unary(req: strims_examples_tester_UnaryRequest, call: strims_rpc_Call): Promise<strims_examples_tester_UnaryResponse> | strims_examples_tester_UnaryResponse;
  stream(req: strims_examples_tester_StreamRequest, call: strims_rpc_Call): GenericReadable<strims_examples_tester_StreamResponse>;
}

export class UnimplementedTesterService implements TesterService {
  unary(req: strims_examples_tester_UnaryRequest, call: strims_rpc_Call): Promise<strims_examples_tester_UnaryResponse> | strims_examples_tester_UnaryResponse { throw new Error("not implemented"); }
  stream(req: strims_examples_tester_StreamRequest, call: strims_rpc_Call): GenericReadable<strims_examples_tester_StreamResponse> { throw new Error("not implemented"); }
}

export const registerTesterService = (host: strims_rpc_Service, service: TesterService): void => {
  host.registerMethod<strims_examples_tester_UnaryRequest, strims_examples_tester_UnaryResponse>("strims.examples.tester.Tester.Unary", service.unary.bind(service), strims_examples_tester_UnaryRequest);
  host.registerMethod<strims_examples_tester_StreamRequest, strims_examples_tester_StreamResponse>("strims.examples.tester.Tester.Stream", service.stream.bind(service), strims_examples_tester_StreamRequest);
}

export class TesterClient {
  constructor(private readonly host: strims_rpc_Host) {}

  public unary(req?: strims_examples_tester_IUnaryRequest, opts?: strims_rpc_UnaryCallOptions): Promise<strims_examples_tester_UnaryResponse> {
    return this.host.expectOne(this.host.call("strims.examples.tester.Tester.Unary", new strims_examples_tester_UnaryRequest(req)), strims_examples_tester_UnaryResponse, opts);
  }

  public stream(req?: strims_examples_tester_IStreamRequest): GenericReadable<strims_examples_tester_StreamResponse> {
    return this.host.expectMany(this.host.call("strims.examples.tester.Tester.Stream", new strims_examples_tester_StreamRequest(req)), strims_examples_tester_StreamResponse);
  }
}

