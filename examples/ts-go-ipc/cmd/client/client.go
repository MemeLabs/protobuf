package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"time"

	"github.com/MemeLabs/protobuf/examples/ts-go-ipc/pkg/apis/greeter"
	"github.com/MemeLabs/protobuf/examples/ts-go-ipc/pkg/apis/ticker"
	"github.com/MemeLabs/protobuf/pkg/rpc"
	"go.uber.org/zap"
)

type stdio struct {
	io.Reader
	io.Writer
}

func main() {
	logger, err := zap.NewDevelopment()
	if err != nil {
		panic(err)
	}

	cmd := exec.Command("go", "run", "./cmd/server/")
	// cmd := exec.Command("npx", "ts-node", "./src/server.ts")

	stdin, err := cmd.StdinPipe()
	if err != nil {
		panic(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		panic(err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		panic(err)
	}

	if err := cmd.Start(); err != nil {
		panic(err)
	}

	go io.Copy(os.Stderr, stderr)

	client, err := rpc.NewClient(logger, &rpc.RWDialer{
		Logger:          logger,
		ReadWriter:      stdio{stdout, stdin},
		MaxMessageBytes: 32 * 1024,
	})
	if err != nil {
		panic(err)
	}

	greeterClient := greeter.NewGreeterClient(client)
	var res greeter.GreetResponse
	err = greeterClient.Greet(context.Background(), &greeter.GreetRequest{Name: "world"}, &res)
	if err != nil {
		panic(err)
	}
	fmt.Println(res.Greeting)

	tickerClient := ticker.NewTickerClient(client)
	stream := make(chan *ticker.TickResponse)
	done := make(chan struct{})
	go func() {
		for res := range stream {
			fmt.Println(
				res.Index,
				time.Unix(res.Time.Seconds, int64(res.Time.Nanos)),
			)
		}
		close(done)
	}()
	err = tickerClient.Tick(context.Background(), &ticker.TickRequest{Times: 5}, stream)
	if err != nil {
		panic(err)
	}

	<-done
	fmt.Println("done")

	if err := cmd.Process.Kill(); err != nil {
		panic(err)
	}
}
