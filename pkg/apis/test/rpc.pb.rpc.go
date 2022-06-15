package test

import (
	"context"

	"github.com/MemeLabs/protobuf/pkg/rpc"
)

// RegisterRPCTestService ...
func RegisterRPCTestService(host rpc.ServiceRegistry, service RPCTestService) {
	host.RegisterMethod("strims.test.RPCTest.CallUnary", service.CallUnary)
	host.RegisterMethod("strims.test.RPCTest.CallStream", service.CallStream)
}

// RPCTestService ...
type RPCTestService interface {
	CallUnary(
		ctx context.Context,
		req *RPCCallUnaryRequest,
	) (*RPCCallUnaryResponse, error)
	CallStream(
		ctx context.Context,
		req *RPCCallStreamRequest,
	) (<-chan *RPCCallStreamResponse, error)
}

// RPCTestService ...
type UnimplementedRPCTestService struct{}

func (s *UnimplementedRPCTestService) CallUnary(
	ctx context.Context,
	req *RPCCallUnaryRequest,
) (*RPCCallUnaryResponse, error) {
	return nil, rpc.ErrNotImplemented
}

func (s *UnimplementedRPCTestService) CallStream(
	ctx context.Context,
	req *RPCCallStreamRequest,
) (<-chan *RPCCallStreamResponse, error) {
	return nil, rpc.ErrNotImplemented
}

var _ RPCTestService = (*UnimplementedRPCTestService)(nil)

// RPCTestClient ...
type RPCTestClient struct {
	client rpc.Caller
}

// NewRPCTestClient ...
func NewRPCTestClient(client rpc.Caller) *RPCTestClient {
	return &RPCTestClient{client}
}

// CallUnary ...
func (c *RPCTestClient) CallUnary(
	ctx context.Context,
	req *RPCCallUnaryRequest,
	res *RPCCallUnaryResponse,
) error {
	return c.client.CallUnary(ctx, "strims.test.RPCTest.CallUnary", req, res)
}

// CallStream ...
func (c *RPCTestClient) CallStream(
	ctx context.Context,
	req *RPCCallStreamRequest,
	res chan *RPCCallStreamResponse,
) error {
	return c.client.CallStreaming(ctx, "strims.test.RPCTest.CallStream", req, res)
}
