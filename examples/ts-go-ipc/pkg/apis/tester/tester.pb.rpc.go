package tester

import (
	"context"

	"github.com/MemeLabs/protobuf/pkg/rpc"
)

// RegisterTesterService ...
func RegisterTesterService(host rpc.ServiceRegistry, service TesterService) {
	host.RegisterMethod("strims.examples.tester.Tester.Unary", service.Unary)
	host.RegisterMethod("strims.examples.tester.Tester.Stream", service.Stream)
}

// TesterService ...
type TesterService interface {
	Unary(
		ctx context.Context,
		req *UnaryRequest,
	) (*UnaryResponse, error)
	Stream(
		ctx context.Context,
		req *StreamRequest,
	) (<-chan *StreamResponse, error)
}

// TesterService ...
type UnimplementedTesterService struct{}

func (s *UnimplementedTesterService) Unary(
	ctx context.Context,
	req *UnaryRequest,
) (*UnaryResponse, error) {
	return nil, rpc.ErrNotImplemented
}

func (s *UnimplementedTesterService) Stream(
	ctx context.Context,
	req *StreamRequest,
) (<-chan *StreamResponse, error) {
	return nil, rpc.ErrNotImplemented
}

var _ TesterService = (*UnimplementedTesterService)(nil)

// TesterClient ...
type TesterClient struct {
	client rpc.Caller
}

// NewTesterClient ...
func NewTesterClient(client rpc.Caller) *TesterClient {
	return &TesterClient{client}
}

// Unary ...
func (c *TesterClient) Unary(
	ctx context.Context,
	req *UnaryRequest,
	res *UnaryResponse,
) error {
	return c.client.CallUnary(ctx, "strims.examples.tester.Tester.Unary", req, res)
}

// Stream ...
func (c *TesterClient) Stream(
	ctx context.Context,
	req *StreamRequest,
	res chan *StreamResponse,
) error {
	return c.client.CallStreaming(ctx, "strims.examples.tester.Tester.Stream", req, res)
}
