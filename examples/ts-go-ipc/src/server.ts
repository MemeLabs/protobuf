import { PassThrough } from "stream";

import Host from "@memelabs/protobuf/lib/rpc/host";
import { Readable } from "@memelabs/protobuf/lib/rpc/stream";

import { GreetRequest, GreetResponse } from "./apis/strims/examples/greeter/greeter";
import { registerGreeterService } from "./apis/strims/examples/greeter/greeter_rpc";
import { TickRequest, TickResponse } from "./apis/strims/examples/ticker/ticker";
import { registerTickerService } from "./apis/strims/examples/ticker/ticker_rpc";

class Service {
  greet(req: GreetRequest): GreetResponse {
    return new GreetResponse({
      greeting: `Hello, ${req.name}!`,
    });
  }

  tick(req: TickRequest): Readable<TickResponse> {
    const res = new PassThrough({
      objectMode: true,
    });

    let i = 0;
    const iid = setInterval(() => {
      const now = Date.now();
      res.push(
        new TickResponse({
          index: i++,
          time: {
            seconds: BigInt((now / 1000) >>> 0),
            nanos: (now % 1000) * 1000000,
          },
        })
      );

      if (i >= req.times) {
        clearInterval(iid);
        res.end();
      }
    }, 1000);

    return res;
  }
}

const host = new Host(process.stdout, process.stdin);

const service = new Service();
registerGreeterService(host, service);
registerTickerService(host, service);
