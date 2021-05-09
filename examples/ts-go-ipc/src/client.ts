import { spawn } from "child_process";
import path from "path";

import Host from "@memelabs/protobuf/lib/rpc/host";

import { GreeterClient } from "./apis/strims/examples/greeter/greeter_rpc";
import { TickerClient } from "./apis/strims/examples/ticker/ticker_rpc";

const proc =
  process.argv[process.argv.length - 1] === "go"
    ? spawn("go", ["run", path.join(__dirname, "..", "cmd", "server", ".")])
    : spawn("npx", ["ts-node", path.join(__dirname, "server.ts")]);

const client = new Host(proc.stdin, proc.stdout);

proc.stderr.pipe(process.stderr);

void (async () => {
  const greeterClient = new GreeterClient(client);
  const res = await greeterClient.greet({ name: "world" }, { timeout: 10000 });
  console.log(res.greeting);

  const tickerClient = new TickerClient(client);
  const stream = tickerClient.tick({ times: 5 });
  for await (const res of stream) {
    console.log(
      "tick",
      res.index,
      new Date(Number(res.time.seconds) * 1000 + res.time.nanos / 1000000)
    );
  }
  console.log("done");

  proc.kill();
})();
