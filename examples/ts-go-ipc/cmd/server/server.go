package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/MemeLabs/protobuf/examples/ts-go-ipc/pkg/apis/greeter"
	"github.com/MemeLabs/protobuf/examples/ts-go-ipc/pkg/apis/ticker"
	"github.com/MemeLabs/protobuf/pkg/rpc"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type service struct{}

func (s *service) Greet(ctx context.Context, req *greeter.GreetRequest) (*greeter.GreetResponse, error) {
	res := &greeter.GreetResponse{
		Greeting: fmt.Sprintf("Hello, %s!", req.Name),
	}
	return res, nil
}

func (s *service) Tick(ctx context.Context, req *ticker.TickRequest) (<-chan *ticker.TickResponse, error) {
	res := make(chan *ticker.TickResponse)

	go func() {
		t := time.NewTicker(time.Second)
		defer t.Stop()

		for i := int32(0); i < req.Times; i++ {
			select {
			case now := <-t.C:
				res <- &ticker.TickResponse{
					Index: i,
					Time: &timestamppb.Timestamp{
						Seconds: now.Unix(),
						Nanos:   int32(now.Nanosecond()),
					},
				}
			case <-ctx.Done():
				return
			}
		}

		close(res)
	}()

	return res, nil
}

type stdio struct {
	io.Reader
	io.Writer
}

func main() {
	logger, err := zap.NewDevelopment()
	if err != nil {
		panic(err)
	}

	server := rpc.NewServer(logger, &rpc.RWDialer{
		Logger:          logger,
		ReadWriter:      stdio{os.Stdin, os.Stdout},
		MaxMessageBytes: 32 * 1024,
	})

	greeter.RegisterGreeterService(server, &service{})
	ticker.RegisterTickerService(server, &service{})

	if err := server.Listen(context.Background()); err != nil {
		logger.Debug("server closed with error", zap.Error(err))
	}
}
