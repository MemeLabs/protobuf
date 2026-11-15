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
//
// The cancelable context is created lazily: outside init, use Context and
// Cancel, never ctx and cancel, which would race with init.
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
	frameBytes   int // encoded size of req as received, 0 if unknown
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
	if err := send(c.Context(), id, c.req.Id, callbackMethod, kind, res, c.send); err != nil {
		return err
	}
	return nil
}

func (c *CallIn) returnUndefined() {
	c.responseType = ResponseTypeUndefined
	c.sendResponse(pb.Call_CALL_KIND_UNDEFINED, &pb.Undefined{})
	c.Cancel()
}

func (c *CallIn) returnError(err error) {
	c.responseType = ResponseTypeError
	c.sendResponse(pb.Call_CALL_KIND_ERROR, &pb.Error{
		Message: err.Error(),
		Code:    ErrorCode(err),
	})
	c.Cancel()
}

func (c *CallIn) returnValue(v proto.Message) {
	c.responseType = ResponseTypeValue
	c.sendResponse(pb.Call_CALL_KIND_DEFAULT, v)
	c.Cancel()
}

func (c *CallIn) returnStream(v interface{}) {
	c.responseType = ResponseTypeStream
	ctx := c.Context()

	cases := []reflect.SelectCase{
		{
			Dir:  reflect.SelectRecv,
			Chan: reflect.ValueOf(v),
		},
		{
			Dir:  reflect.SelectRecv,
			Chan: reflect.ValueOf(ctx.Done()),
		},
	}

	for {
		_, v, ok := reflect.Select(cases)

		if ctx.Err() != nil {
			return
		}

		if !ok {
			c.sendResponse(pb.Call_CALL_KIND_CLOSE, &pb.Close{})
			c.Cancel()
			return
		}

		if err := c.sendResponse(pb.Call_CALL_KIND_DEFAULT, v.Interface().(proto.Message)); err != nil {
			c.Cancel()
			return
		}
	}
}

var emptyCallOut = &CallOut{}

// Coarse allowances counted against the stream buffer limit on top of each
// queued response's encoded size.
const (
	queuedResponseOverhead = 256 // per response
	queuedHeaderOverhead   = 128 // per header entry
)

// NewCallOut ...
func NewCallOut(ctx context.Context, method string, arg proto.Message) (*CallOut, error) {
	return NewCallOutWithParent(ctx, method, arg, emptyCallOut)
}

// NewCallOutWithParent ...
func NewCallOutWithParent(ctx context.Context, method string, arg proto.Message, parent Call) (*CallOut, error) {
	return &CallOut{
		CallBase:      NewCallBase(ctx),
		id:            atomic.AddUint64(nextID, 1),
		parentID:      parent.ID(),
		method:        method,
		arg:           arg,
		maxQueueBytes: defaultMinStreamBufferBytes,
		notify:        make(chan struct{}, 1),
		aborted:       make(chan struct{}),
	}, nil
}

// CallOut is an outgoing call. AssignResponse queues its responses without
// blocking. A response that would take a non-empty queue over maxQueueBytes
// (16 MiB by default; <= 0 means unbounded), counted by responseCost,
// discards the queue and fails the call with ErrStreamBufferFull.
type CallOut struct {
	CallBase
	id       uint64
	parentID uint64
	method   string
	arg      proto.Message

	mu            sync.Mutex
	queue         []queuedResponse
	queueBytes    int
	maxQueueBytes int
	err           error
	notify        chan struct{} // signalled when queue or err changes
	aborted       chan struct{} // closed when the buffer overflows
}

type queuedResponse struct {
	req  *pb.Call
	cost int
}

// responseCost is what a queued response counts against maxQueueBytes: its
// encoded size plus the per-response and per-header allowances.
func responseCost(res *CallIn) int {
	n := res.frameBytes
	if n == 0 {
		n = proto.Size(res.req)
	}
	return n + queuedResponseOverhead + len(res.req.Headers)*queuedHeaderOverhead
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
	return send(c.Context(), c.id, c.parentID, c.method, pb.Call_CALL_KIND_DEFAULT, c.arg, fn)
}

// setMaxQueueBytes sets the response buffer limit. n <= 0 means unbounded.
func (c *CallOut) setMaxQueueBytes(n int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.maxQueueBytes = n
}

// AssignResponse queues a response for ReadResponse. It never blocks.
func (c *CallOut) AssignResponse(res *CallIn) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.err != nil {
		return
	}

	n := responseCost(res)
	if c.maxQueueBytes > 0 && len(c.queue) > 0 && c.queueBytes+n > c.maxQueueBytes {
		c.queue = nil
		c.queueBytes = 0
		c.failLocked(ErrStreamBufferFull)
		close(c.aborted)
		return
	}

	c.queue = append(c.queue, queuedResponse{res.req, n})
	c.queueBytes += n
	c.signalLocked()
}

// fail ends the call with err once the responses already queued are read.
func (c *CallOut) fail(err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.failLocked(err)
}

func (c *CallOut) failLocked(err error) {
	if c.err == nil {
		c.err = err
		c.signalLocked()
	}
}

func (c *CallOut) signalLocked() {
	select {
	case c.notify <- struct{}{}:
	default:
	}
}

func (c *CallOut) failure() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.err
}

// nextResponse pops the oldest queued response. If the queue is empty it
// returns the call's terminal error, which is nil while the call is live.
func (c *CallOut) nextResponse() (*pb.Call, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if len(c.queue) == 0 {
		return nil, c.err
	}

	r := c.queue[0]
	c.queue[0] = queuedResponse{}
	c.queue = c.queue[1:]
	if len(c.queue) == 0 {
		c.queue = nil
	}
	c.queueBytes -= r.cost
	return r.req, nil
}

// ReadResponse ...
func (c *CallOut) ReadResponse(out proto.Message) error {
	ctx := c.Context()
	for {
		if err := ctx.Err(); err != nil {
			return err
		}

		r, err := c.nextResponse()
		if r != nil {
			return unmarshalResponse(r.Kind, r.Argument, out)
		}
		if err != nil {
			return err
		}

		select {
		case <-c.notify:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

var typeOfProtoMessage = reflect.TypeOf((*proto.Message)(nil)).Elem()

// ReadResponseStream sends responses to res, a chan of a proto.Message type,
// until the stream closes, the call fails or its context is done, and then
// closes res. A reader may stop reading once it cancels the context.
func (c *CallOut) ReadResponseStream(res interface{}) error {
	ch := reflect.ValueOf(res)
	if ch.Kind() != reflect.Chan || !ch.Type().Elem().Implements(typeOfProtoMessage) {
		panic("res must be a chan of a type that implements proto.Message")
	}

	defer ch.Close()

	ctx := c.Context()
	cases := []reflect.SelectCase{
		{Dir: reflect.SelectSend, Chan: ch},
		{Dir: reflect.SelectRecv, Chan: reflect.ValueOf(ctx.Done())},
		{Dir: reflect.SelectRecv, Chan: reflect.ValueOf(c.aborted)},
	}

	for {
		v := reflect.New(ch.Type().Elem().Elem())
		err := c.ReadResponse(v.Interface().(proto.Message))
		if err == ErrClose {
			return nil
		} else if err != nil {
			return err
		}

		cases[0].Send = v
		switch chosen, _, _ := reflect.Select(cases); chosen {
		case 1:
			return ctx.Err()
		case 2:
			return c.failure()
		}
	}
}
