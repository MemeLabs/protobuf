import strims_rpc_Host from "@memelabs/protobuf/lib/rpc/host";
import strims_rpc_Service from "@memelabs/protobuf/lib/rpc/service";
import { registerType } from "@memelabs/protobuf/lib/rpc/registry";
import { Call as strims_rpc_Call } from "@memelabs/protobuf/lib/apis/strims/rpc/rpc";
import { Readable as GenericReadable } from "@memelabs/protobuf/lib/rpc/stream";

import {
  ITickRequest,
  TickRequest,
  TickResponse,
} from "./ticker";

registerType("strims.examples.ticker.TickRequest", TickRequest);
registerType("strims.examples.ticker.TickResponse", TickResponse);

export interface TickerService {
  tick(req: TickRequest, call: strims_rpc_Call): GenericReadable<TickResponse>;
}

export const registerTickerService = (host: strims_rpc_Service, service: TickerService): void => {
  host.registerMethod<TickRequest, TickResponse>("strims.examples.ticker.Ticker.Tick", service.tick.bind(service));
}

export class TickerClient {
  constructor(private readonly host: strims_rpc_Host) {}

  public tick(req?: ITickRequest): GenericReadable<TickResponse> {
    return this.host.expectMany(this.host.call("strims.examples.ticker.Ticker.Tick", new TickRequest(req)));
  }
}

