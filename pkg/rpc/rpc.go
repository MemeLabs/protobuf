package rpc

import (
	"context"
	"encoding/binary"
	"errors"
	"sync"

	// "sync"

	pb "github.com/MemeLabs/protobuf/pkg/apis/rpc"
	"google.golang.org/protobuf/proto"
)

const (
	callbackMethod = "CALLBACK"
	cancelMethod   = "CANCEL"

	anyURLPrefix = "strims.gg/"
)

func recoverError(v interface{}) error {
	switch err := v.(type) {
	case nil:
		return nil
	case error:
		return err
	case string:
		return errors.New(err)
	default:
		return errors.New("unknown error")
	}
}

var typeOfError = (&pb.Error{}).ProtoReflect().Type()
var typeOfClose = (&pb.Close{}).ProtoReflect().Type()

// ErrClose returned when the the server closes a streaming response
var ErrClose = errors.New("response closed")

// ErrInvalidType returned when the request or response type doesn't match the
// expected value
var ErrInvalidType = errors.New("invaild type")

func unmarshalResponse(kind pb.Call_Kind, b []byte, v proto.Message) error {
	switch kind {
	case pb.Call_CALL_KIND_DEFAULT:
		return proto.Unmarshal(b, v)
	case pb.Call_CALL_KIND_ERROR:
		ev := &pb.Error{}
		if err := proto.Unmarshal(b, ev); err != nil {
			return err
		}
		return ev
	case pb.Call_CALL_KIND_CLOSE:
		return ErrClose
	default:
		return ErrInvalidType
	}
}

var bufPool = sync.Pool{
	New: func() interface{} {
		return make([]byte, 1024)
	},
}

// SendFunc ...
type SendFunc func(context.Context, *pb.Call) error

func send(ctx context.Context, id, parentID uint64, method string, kind pb.Call_Kind, arg proto.Message, fn SendFunc) error {
	b := bufPool.Get().([]byte)[:0]
	b, err := proto.MarshalOptions{}.MarshalAppend(b, arg)
	defer bufPool.Put(b)
	if err != nil {
		return err
	}

	rc := &pb.Call{
		Id:       id,
		ParentId: parentID,
		Method:   method,
		Kind:     kind,
		Argument: b,
		Headers:  map[string][]byte{},
	}
	return fn(ctx, rc)
}

func marshalAppendLengthDelimited(b []byte, m proto.Message) ([]byte, error) {
	opt := proto.MarshalOptions{}
	ms := opt.Size(m)

	if cap(b) < binary.MaxVarintLen32 {
		b = make([]byte, binary.MaxVarintLen32+ms)
	}

	n := binary.PutUvarint(b[:binary.MaxVarintLen32], uint64(ms))
	return opt.MarshalAppend(b[:n], m)
}

// ResponseFunc ...
type ResponseFunc func() error

// Transport ...
type Transport interface {
	Call(*CallOut, ResponseFunc) error
	Listen() error
}

// Dialer ...
type Dialer interface {
	Dial(context.Context, Dispatcher) (Transport, error)
}

// ParentCallAccessor ...
type ParentCallAccessor interface {
	ParentCallIn() *CallIn
	ParentCallOut() *CallOut
}
