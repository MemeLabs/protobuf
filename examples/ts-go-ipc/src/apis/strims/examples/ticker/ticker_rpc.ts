import strims_rpc_Host from "@memelabs/protobuf/lib/rpc/host";
import strims_rpc_Service from "@memelabs/protobuf/lib/rpc/service";
import { Call as strims_rpc_Call } from "@memelabs/protobuf/lib/apis/strims/rpc/rpc";
import { Readable as GenericReadable } from "@memelabs/protobuf/lib/rpc/stream";

import {
  strims_examples_ticker_ITickRequest,
  strims_examples_ticker_TickRequest,
  strims_examples_ticker_TickResponse,
} from "./ticker";

export interface TickerService {
  tick(req: strims_examples_ticker_TickRequest, call: strims_rpc_Call): GenericReadable<strims_examples_ticker_TickResponse>;
}

export class UnimplementedTickerService implements TickerService {
  tick(req: strims_examples_ticker_TickRequest, call: strims_rpc_Call): GenericReadable<strims_examples_ticker_TickResponse> { throw new Error("not implemented"); }
}

export const registerTickerService = (host: strims_rpc_Service, service: TickerService): void => {
  host.registerMethod<strims_examples_ticker_TickRequest, strims_examples_ticker_TickResponse>("strims.examples.ticker.Ticker.Tick", service.tick.bind(service), strims_examples_ticker_TickRequest);
}

export class TickerClient {
  constructor(private readonly host: strims_rpc_Host) {}

  public tick(req?: strims_examples_ticker_ITickRequest): GenericReadable<strims_examples_ticker_TickResponse> {
    return this.host.expectMany(this.host.call("strims.examples.ticker.Ticker.Tick", new strims_examples_ticker_TickRequest(req)), strims_examples_ticker_TickResponse);
  }
}

