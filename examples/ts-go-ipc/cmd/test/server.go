package main

import (
	"context"
	"io"

	"github.com/MemeLabs/protobuf/examples/ts-go-ipc/pkg/apis/tester"
	"github.com/MemeLabs/protobuf/pkg/rpc"
	"go.uber.org/zap"
)

type service struct{}

func (s *service) Unary(ctx context.Context, req *tester.UnaryRequest) (*tester.UnaryResponse, error) {
	res := &tester.UnaryResponse{
		Value: req.Value,
	}
	return res, nil
}

func (s *service) Stream(ctx context.Context, req *tester.StreamRequest) (<-chan *tester.StreamResponse, error) {
	stream := make(chan *tester.StreamResponse)

	go func() {
		res := &tester.StreamResponse{Value: 5}
		for i := int64(0); i < req.Value; i++ {
			stream <- res
		}

		close(stream)
	}()

	return stream, nil
}

func runServer(ctx context.Context, logger *zap.Logger, rw io.ReadWriter) {
	server := rpc.NewServer(logger, &rpc.RWDialer{
		Logger:          logger,
		ReadWriter:      rw,
		MaxMessageBytes: 32 * 1024,
	})

	tester.RegisterTesterService(server, &service{})

	if err := server.Listen(context.Background()); err != nil {
		logger.Debug("server closed with error", zap.Error(err))
	}
}
