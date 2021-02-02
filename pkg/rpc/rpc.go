package rpc

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"sync"

	pb "github.com/MemeLabs/protobuf/pkg/apis/rpc"
	"github.com/golang/protobuf/proto"
	"github.com/golang/protobuf/ptypes"
	"github.com/golang/protobuf/ptypes/any"
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

var typeOfError = reflect.TypeOf(&pb.Error{})
var typeOfClose = reflect.TypeOf(&pb.Close{})

// ErrClose returned when the the server closes a streaming response
var ErrClose = errors.New("response closed")

// ErrInvalidType returned when the request or response type doesn't match the
// expected value
var ErrInvalidType = errors.New("invaild type")

func newAnyMessage(a *any.Any) (proto.Message, error) {
	n, err := ptypes.AnyMessageName(a)
	if err != nil {
		return nil, err
	}
	k := proto.MessageType(n)
	if k == nil {
		return nil, ErrInvalidType
	}
	return reflect.New(k.Elem()).Interface().(proto.Message), nil
}

func unmarshalAny(a *any.Any, v proto.Message) error {
	n, err := ptypes.AnyMessageName(a)
	if err != nil {
		return err
	}

	at := proto.MessageType(n)
	vt := reflect.TypeOf(v)
	switch at {
	case vt:
		return ptypes.UnmarshalAny(a, v)
	case typeOfClose:
		return ErrClose
	case typeOfError:
		ev := &pb.Error{}
		if err := ptypes.UnmarshalAny(a, ev); err != nil {
			return err
		}
		return errors.New(ev.Message)
	default:
		return fmt.Errorf("Using %s as type %s", at, vt)
	}
}

// SendFunc ...
type SendFunc func(context.Context, *pb.Call) error

var callBuffers = sync.Pool{
	New: func() interface{} {
		return proto.NewBuffer([]byte{})
	},
}

func send(ctx context.Context, id, parentID uint64, method string, arg proto.Message, fn SendFunc) error {
	b := callBuffers.Get().(*proto.Buffer)
	defer callBuffers.Put(b)

	b.Reset()
	if err := b.Marshal(arg); err != nil {
		return err
	}

	rc := &pb.Call{
		Id:       id,
		ParentId: parentID,
		Method:   method,
		Argument: &any.Any{
			TypeUrl: anyURLPrefix + proto.MessageName(arg),
			Value:   b.Bytes(),
		},
		Headers: map[string][]byte{},
	}
	return fn(ctx, rc)
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
