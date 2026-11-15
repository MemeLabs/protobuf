import { spawn } from "child_process";
import path from "path";

import Host from "@memelabs/protobuf/lib/rpc/host";

import { GreeterClient } from "./apis/strims/examples/greeter/greeter_rpc.pb";
import { TickerClient } from "./apis/strims/examples/ticker/ticker_rpc.pb";

const proc =
  process.argv[process.argv.length - 1] === "go"
    ? spawn("go", ["run", path.join(__dirname, "..", "cmd", "server", ".")])
    : spawn("pnpm", ["exec", "ts-node", path.join(__dirname, "server.ts")]);

const client = new Host(proc.stdin, proc.stdout);

proc.stderr.pipe(process.stderr);

void (async () => {
  const greeterClient = new GreeterClient(client);
  const res = await greeterClient.greet({ name: "world" }, { timeout: 10000 });
  console.log(res.greeting);

  const tickerClient = new TickerClient(client);
  const stream = tickerClient.tick({ times: 5 });
  for await (const { index, time } of stream) {
    // an unset timestamp is the epoch
    const ms = time ? Number(time.seconds) * 1000 + time.nanos / 1000000 : 0;
    console.log("tick", index, new Date(ms));
  }
  console.log("done");

  proc.kill();
})();
