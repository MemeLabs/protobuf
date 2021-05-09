package main

import (
	"io"

	"github.com/MemeLabs/protobuf/examples/ts-go-ipc/pkg/apis/tester"
	"github.com/MemeLabs/protobuf/pkg/rpc"
	"go.uber.org/zap"
)

type stdio struct {
	io.Reader
	io.Writer
}

type client struct {
	tester *tester.TesterClient
}

func newClient(logger *zap.Logger, rw io.ReadWriter) *client {
	c, err := rpc.NewClient(logger, &rpc.RWDialer{
		Logger:          logger,
		ReadWriter:      rw,
		MaxMessageBytes: 32 * 1024,
	})
	if err != nil {
		panic(err)
	}

	return &client{
		tester: tester.NewTesterClient(c),
	}
}
