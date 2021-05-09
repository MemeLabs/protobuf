package rpc

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"sync"

	pb "github.com/MemeLabs/protobuf/pkg/apis/rpc"
	"github.com/MemeLabs/protobuf/pkg/bytereader"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
)

const defaultMaxMessageBytes = 512 * 1024

// ErrMessageTooLarge emitted when received message exceeds configured limit
var ErrMessageTooLarge = errors.New("received message too large")

// RWDialer ...
type RWDialer struct {
	Logger          *zap.Logger
	ReadWriter      io.ReadWriter
	MaxMessageBytes int
}

// Dial ...
func (d *RWDialer) Dial(ctx context.Context, dispatcher Dispatcher) (Transport, error) {
	maxMessageBytes := d.MaxMessageBytes
	if maxMessageBytes == 0 {
		maxMessageBytes = defaultMaxMessageBytes
	}

	return &RWTransport{
		ctx:             ctx,
		logger:          d.Logger,
		rw:              d.ReadWriter,
		maxMessageBytes: maxMessageBytes,
		dispatcher:      dispatcher,
		calls: &rwParentCallMap{
			callsIn:  map[uint64]*CallIn{},
			callsOut: map[uint64]*CallOut{},
		},
	}, nil
}

// RWTransport ...
type RWTransport struct {
	ctx             context.Context
	logger          *zap.Logger
	rw              io.ReadWriter
	maxMessageBytes int
	dispatcher      Dispatcher
	calls           *rwParentCallMap
	wbuf            []byte
}

// Listen reads incoming calls
func (t *RWTransport) Listen() error {
	b := make([]byte, 1024)
	brw := bytereader.New(t.rw)

	for {
		l, err := binary.ReadUvarint(brw)
		if err != nil {
			return err
		}
		if int(l) > t.maxMessageBytes {
			return ErrMessageTooLarge
		}
		if int(l) > cap(b) {
			b = make([]byte, l)
		}
		b = b[:l]

		if _, err := io.ReadAtLeast(t.rw, b, int(l)); err != nil {
			return err
		}

		req := &pb.Call{}
		if err := proto.Unmarshal(b, req); err != nil {
			continue
		}

		call := NewCallIn(t.ctx, req, t.calls.Accessor(req.ParentId), t.send)

		t.calls.SetCallIn(req.Id, call)
		t.dispatcher.Dispatch(call, func() { t.calls.DeleteCallIn(req.Id) })

		if err := t.ctx.Err(); err != nil {
			return err
		}
	}
}

func (t *RWTransport) send(ctx context.Context, call *pb.Call) error {
	b := bufPool.Get().([]byte)[:0]
	b, err := marshalAppendLengthDelimited(b, call)
	defer bufPool.Put(b)
	if err != nil {
		return err
	}

	if _, err := t.rw.Write(b); err != nil {
		return err
	}

	return nil
}

// Call ...
func (t *RWTransport) Call(call *CallOut, fn ResponseFunc) error {
	t.calls.SetCallOut(call.ID(), call)
	defer t.calls.DeleteCallOut(call.ID())

	if err := call.SendRequest(t.send); err != nil {
		return err
	}

	return fn()
}

type rwParentCallMap struct {
	callsInLock  sync.Mutex
	callsIn      map[uint64]*CallIn
	callsOutLock sync.Mutex
	callsOut     map[uint64]*CallOut
}

func (m *rwParentCallMap) SetCallIn(id uint64, c *CallIn) {
	m.callsInLock.Lock()
	defer m.callsInLock.Unlock()
	m.callsIn[id] = c
}

func (m *rwParentCallMap) CallIn(id uint64) *CallIn {
	m.callsInLock.Lock()
	defer m.callsInLock.Unlock()
	return m.callsIn[id]
}

func (m *rwParentCallMap) DeleteCallIn(id uint64) {
	m.callsInLock.Lock()
	defer m.callsInLock.Unlock()
	delete(m.callsIn, id)
}

func (m *rwParentCallMap) SetCallOut(id uint64, c *CallOut) {
	m.callsOutLock.Lock()
	defer m.callsOutLock.Unlock()
	m.callsOut[id] = c
}

func (m *rwParentCallMap) CallOut(id uint64) *CallOut {
	m.callsOutLock.Lock()
	defer m.callsOutLock.Unlock()
	return m.callsOut[id]
}

func (m *rwParentCallMap) DeleteCallOut(id uint64) {
	m.callsOutLock.Lock()
	defer m.callsOutLock.Unlock()
	delete(m.callsOut, id)
}

func (m *rwParentCallMap) Accessor(id uint64) ParentCallAccessor {
	return &rwParentCallAccessor{id, m}
}

type rwParentCallAccessor struct {
	id uint64
	m  *rwParentCallMap
}

func (a *rwParentCallAccessor) ParentCallIn() *CallIn {
	return a.m.CallIn(a.id)
}

func (a *rwParentCallAccessor) ParentCallOut() *CallOut {
	return a.m.CallOut(a.id)
}
