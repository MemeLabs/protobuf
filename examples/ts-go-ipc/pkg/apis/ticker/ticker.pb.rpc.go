package ticker

import (
	"context"

	"github.com/MemeLabs/protobuf/pkg/rpc"
)

// RegisterTickerService ...
func RegisterTickerService(host rpc.ServiceRegistry, service TickerService) {
	host.RegisterMethod("strims.examples.ticker.Ticker.Tick", service.Tick)
}

// TickerService ...
type TickerService interface {
	Tick(
		ctx context.Context,
		req *TickRequest,
	) (<-chan *TickResponse, error)
}

// TickerService ...
type UnimplementedTickerService struct{}

func (s *UnimplementedTickerService) Tick(
	ctx context.Context,
	req *TickRequest,
) (<-chan *TickResponse, error) {
	return nil, rpc.ErrNotImplemented
}

var _ TickerService = (*UnimplementedTickerService)(nil)

// TickerClient ...
type TickerClient struct {
	client rpc.Caller
}

// NewTickerClient ...
func NewTickerClient(client rpc.Caller) *TickerClient {
	return &TickerClient{client}
}

// Tick ...
func (c *TickerClient) Tick(
	ctx context.Context,
	req *TickRequest,
	res chan *TickResponse,
) error {
	return c.client.CallStreaming(ctx, "strims.examples.ticker.Ticker.Tick", req, res)
}
