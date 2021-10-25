package rpc

import (
	"context"
	"reflect"
	"sync"
	"sync/atomic"

	pb "github.com/MemeLabs/protobuf/pkg/apis/rpc"
	"google.golang.org/protobuf/proto"
)

var nextID = new(uint64)

// ResponseType ...
type ResponseType int

func (t ResponseType) String() string {
	return responseTypeName[t]
}

// ResponseTypes ...
const (
	ResponseTypeNone = iota
	ResponseTypeUndefined
	ResponseTypeError
	ResponseTypeStream
	ResponseTypeValue
)

var responseTypeName = map[ResponseType]string{
	ResponseTypeNone:      "NONE",
	ResponseTypeUndefined: "UNDEFINED",
	ResponseTypeError:     "ERROR",
	ResponseTypeStream:    "STREAM",
	ResponseTypeValue:     "VALUE",
}

// Dispatcher ...
type Dispatcher interface {
	Dispatch(*CallIn, func())
}

// Call ...
type Call interface {
	ID() uint64
}

var noopCancelFunc = func() {}

// NewCallBase ...
func NewCallBase(ctx context.Context) CallBase {
	return CallBase{
		ctx:    ctx,
		cancel: noopCancelFunc,
	}
}

// CallBase ...
type CallBase struct {
	initOnce sync.Once
	ctx      context.Context
	cancel   context.CancelFunc
}

func (c *CallBase) init() {
	c.ctx, c.cancel = context.WithCancel(c.ctx)
}

// Context ...
func (c *CallBase) Context() context.Context {
	c.initOnce.Do(c.init)
	return c.ctx
}

// Cancel ...
func (c *CallBase) Cancel() {
	c.initOnce.Do(c.init)
	c.cancel()
}

// NewCallIn ...
func NewCallIn(ctx context.Context, req *pb.Call, parentCallAcessor ParentCallAccessor, send SendFunc) *CallIn {
	return &CallIn{
		CallBase:           NewCallBase(ctx),
		req:                req,
		ParentCallAccessor: parentCallAcessor,
		send:               send,
	}
}

// CallIn ...
type CallIn struct {
	CallBase
	ParentCallAccessor
	req          *pb.Call
	responseType ResponseType
	send         SendFunc
}

// ID ...
func (c *CallIn) ID() uint64 {
	return c.req.Id
}

// Method ...
func (c *CallIn) Method() string {
	return c.req.Method
}

// ResponseType ...
func (c *CallIn) ResponseType() ResponseType {
	return c.responseType
}

// Argument ...
func (c *CallIn) Argument(arg proto.Message) error {
	return proto.Unmarshal(c.req.Argument, arg)
}

func (c *CallIn) sendResponse(kind pb.Call_Kind, res proto.Message) error {
	id := atomic.AddUint64(nextID, 1)
	if err := send(c.ctx, id, c.req.Id, callbackMethod, kind, res, c.send); err != nil {
		return err
	}
	return nil
}

func (c *CallIn) returnUndefined() {
	c.responseType = ResponseTypeUndefined
	c.sendResponse(pb.Call_CALL_KIND_UNDEFINED, &pb.Undefined{})
	c.cancel()
}

func (c *CallIn) returnError(err error) {
	c.responseType = ResponseTypeError
	c.sendResponse(pb.Call_CALL_KIND_ERROR, &pb.Error{Message: err.Error()})
	c.cancel()
}

func (c *CallIn) returnValue(v proto.Message) {
	c.responseType = ResponseTypeValue
	c.sendResponse(pb.Call_CALL_KIND_DEFAULT, v)
	c.cancel()
}

func (c *CallIn) returnStream(v interface{}) {
	c.responseType = ResponseTypeStream

	cases := []reflect.SelectCase{
		{
			Dir:  reflect.SelectRecv,
			Chan: reflect.ValueOf(v),
		},
		{
			Dir:  reflect.SelectRecv,
			Chan: reflect.ValueOf(c.ctx.Done()),
		},
	}

	for {
		_, v, ok := reflect.Select(cases)

		if c.ctx.Err() != nil {
			return
		}

		if !ok {
			c.sendResponse(pb.Call_CALL_KIND_CLOSE, &pb.Close{})
			c.cancel()
			return
		}

		if err := c.sendResponse(pb.Call_CALL_KIND_DEFAULT, v.Interface().(proto.Message)); err != nil {
			c.cancel()
			return
		}
	}
}

var emptyCallOut = &CallOut{}

// NewCallOut ...
func NewCallOut(ctx context.Context, method string, arg proto.Message) (*CallOut, error) {
	return NewCallOutWithParent(ctx, method, arg, emptyCallOut)
}

// NewCallOutWithParent ...
func NewCallOutWithParent(ctx context.Context, method string, arg proto.Message, parent Call) (*CallOut, error) {
	return &CallOut{
		CallBase: NewCallBase(ctx),
		id:       atomic.AddUint64(nextID, 1),
		parentID: parent.ID(),
		method:   method,
		arg:      arg,
		res:      make(chan *pb.Call),
	}, nil
}

// CallOut ...
type CallOut struct {
	CallBase
	id       uint64
	parentID uint64
	method   string
	arg      proto.Message
	res      chan *pb.Call
}

// ID ...
func (c *CallOut) ID() uint64 {
	return c.id
}

// Method ...
func (c *CallOut) Method() string {
	return c.method
}

// SendRequest ...
func (c *CallOut) SendRequest(fn SendFunc) error {
	return send(c.ctx, c.id, c.parentID, c.method, pb.Call_CALL_KIND_DEFAULT, c.arg, fn)
}

// AssignResponse ...
func (c *CallOut) AssignResponse(res *CallIn) {
	select {
	case c.res <- res.req:
	case <-c.ctx.Done():
	}
}

// ReadResponse ...
func (c *CallOut) ReadResponse(out proto.Message) error {
	select {
	case r := <-c.res:
		return unmarshalResponse(r.Kind, r.Argument, out)
	case <-c.ctx.Done():
		return c.ctx.Err()
	}
}

var typeOfProtoMessage = reflect.TypeOf((*proto.Message)(nil)).Elem()

// ReadResponseStream ...
func (c *CallOut) ReadResponseStream(res interface{}) error {
	ch := reflect.ValueOf(res)
	if ch.Kind() != reflect.Chan || !ch.Type().Elem().Implements(typeOfProtoMessage) {
		panic("res must be a chan of a type that implements proto.Message")
	}

	defer ch.Close()

	for {
		v := reflect.New(ch.Type().Elem().Elem())
		err := c.ReadResponse(v.Interface().(proto.Message))
		if err == ErrClose {
			return nil
		} else if err != nil {
			return err
		}
		ch.Send(v)
	}
}
