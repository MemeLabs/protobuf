package main

import (
	"context"
	"net"
	"testing"

	"github.com/MemeLabs/protobuf/examples/ts-go-ipc/pkg/apis/tester"
	"go.uber.org/zap"
)

func BenchmarkUnary(b *testing.B) {
	logger := zap.NewNop()

	c1, c2 := net.Pipe()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go runServer(ctx, logger, c1)

	client := newClient(logger, c2)

	b.ResetTimer()

	req := &tester.UnaryRequest{
		Value: 5,
	}
	var res tester.UnaryResponse
	for i := 0; i < b.N; i++ {
		client.tester.Unary(ctx, req, &res)
	}
}

func BenchmarkStream(b *testing.B) {
	logger := zap.NewNop()

	c1, c2 := net.Pipe()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go runServer(ctx, logger, c1)

	client := newClient(logger, c2)

	req := &tester.StreamRequest{
		Value: int64(b.N),
	}
	stream := make(chan *tester.StreamResponse)
	go client.tester.Stream(ctx, req, stream)

	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		<-stream
	}
}
