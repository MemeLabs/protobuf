package greeter

import (
	"context"

	"github.com/MemeLabs/protobuf/pkg/rpc"
)

// RegisterGreeterService ...
func RegisterGreeterService(host rpc.ServiceRegistry, service GreeterService) {
	host.RegisterMethod("strims.examples.greeter.Greeter.Greet", service.Greet)
}

// GreeterService ...
type GreeterService interface {
	Greet(
		ctx context.Context,
		req *GreetRequest,
	) (*GreetResponse, error)
}

// GreeterService ...
type UnimplementedGreeterService struct{}

func (s *UnimplementedGreeterService) Greet(
	ctx context.Context,
	req *GreetRequest,
) (*GreetResponse, error) {
	return nil, rpc.ErrNotImplemented
}

var _ GreeterService = (*UnimplementedGreeterService)(nil)

// GreeterClient ...
type GreeterClient struct {
	client rpc.Caller
}

// NewGreeterClient ...
func NewGreeterClient(client rpc.Caller) *GreeterClient {
	return &GreeterClient{client}
}

// Greet ...
func (c *GreeterClient) Greet(
	ctx context.Context,
	req *GreetRequest,
	res *GreetResponse,
) error {
	return c.client.CallUnary(ctx, "strims.examples.greeter.Greeter.Greet", req, res)
}
