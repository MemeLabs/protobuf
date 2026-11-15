package rpc

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"math"
	"sync"

	pb "github.com/MemeLabs/protobuf/pkg/apis/rpc"
	"github.com/MemeLabs/protobuf/pkg/bytereader"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
)

const defaultMaxMessageBytes = 512 * 1024

// defaultMinStreamBufferBytes is the floor of the default MaxStreamBufferBytes.
const defaultMinStreamBufferBytes = 16 * 1024 * 1024

// ErrMessageTooLarge emitted when received message exceeds configured limit
var ErrMessageTooLarge = errors.New("received message too large")

// RWDialer dials a Transport that exchanges length-delimited frames over
// ReadWriter. Writes are serialized, one Write per frame.
//
// The transport closes ReadWriter, if it is an io.Closer, when it stops; Close
// may be called concurrently with Read and Write.
type RWDialer struct {
	Logger          *zap.Logger
	ReadWriter      io.ReadWriter
	MaxMessageBytes int
	// MaxStreamBufferBytes limits, per outgoing call, the bytes of responses
	// that have been received but not yet read by the caller (each counted
	// as its encoded frame plus a fixed per-response overhead). A response
	// that would take a non-empty backlog over the limit fails that call with
	// ErrStreamBufferFull, and the client forwards a cancellation to the
	// server; other calls are unaffected. 0 means the default, the larger of
	// 16 MiB and 4×MaxMessageBytes; a negative value means unbounded.
	MaxStreamBufferBytes int
}

// Dial ...
func (d *RWDialer) Dial(ctx context.Context, dispatcher Dispatcher) (Transport, error) {
	maxMessageBytes := d.MaxMessageBytes
	if maxMessageBytes == 0 {
		maxMessageBytes = defaultMaxMessageBytes
	}

	maxStreamBufferBytes := d.MaxStreamBufferBytes
	if maxStreamBufferBytes == 0 {
		maxStreamBufferBytes = max(defaultMinStreamBufferBytes, 4*maxMessageBytes)
	}

	logger := d.Logger
	if logger == nil {
		logger = zap.NewNop()
	}

	ctx, cancel := context.WithCancel(ctx)

	return &RWTransport{
		ctx:                  ctx,
		cancel:               cancel,
		logger:               logger,
		rw:                   d.ReadWriter,
		maxMessageBytes:      maxMessageBytes,
		maxStreamBufferBytes: maxStreamBufferBytes,
		dispatcher:           dispatcher,
		calls: &rwParentCallMap{
			callsIn:  map[uint64]*CallIn{},
			callsOut: map[uint64]*CallOut{},
		},
	}, nil
}

// RWTransport is the Transport created by RWDialer.
type RWTransport struct {
	ctx                  context.Context
	cancel               context.CancelFunc
	logger               *zap.Logger
	rw                   io.ReadWriter
	maxMessageBytes      int
	maxStreamBufferBytes int
	dispatcher           Dispatcher
	calls                *rwParentCallMap
	writeLock            sync.Mutex
	dispatchLock         sync.Mutex
	closeOnce            sync.Once
}

// Listen reads and dispatches frames until the context passed to Dial is done
// or reading fails, and returns that error promptly. By then incoming calls'
// contexts are cancelled, pending and later outgoing calls fail with
// ErrTransportClosed, ReadWriter is closed if it is an io.Closer, and no more
// frames are dispatched.
func (t *RWTransport) Listen() error {
	errc := make(chan error, 1)
	go func() { errc <- t.readLoop() }()

	var err error
	select {
	case err = <-errc:
	case <-t.ctx.Done():
		err = t.ctx.Err()
	}

	t.close(err)

	// dispatch checks ctx under dispatchLock, so no frame is dispatched after this.
	t.dispatchLock.Lock()
	t.dispatchLock.Unlock()

	return err
}

func (t *RWTransport) readLoop() error {
	b := make([]byte, 1024)
	brw := bytereader.New(t.rw)

	for {
		l, err := binary.ReadUvarint(brw)
		if err != nil {
			return err
		}
		if l > math.MaxInt || int(l) > t.maxMessageBytes {
			return ErrMessageTooLarge
		}
		if int(l) > cap(b) {
			b = make([]byte, l)
		}
		b = b[:l]

		if _, err := io.ReadFull(t.rw, b); err != nil {
			return err
		}

		if err := t.dispatch(b); err != nil {
			return err
		}
	}
}

// dispatch decodes and dispatches one frame under dispatchLock, or drops it
// and returns the context's error if the transport has stopped.
func (t *RWTransport) dispatch(b []byte) error {
	t.dispatchLock.Lock()
	defer t.dispatchLock.Unlock()

	if err := t.ctx.Err(); err != nil {
		return err
	}

	// The frame was read in full, so framing is intact: skip only this frame.
	req := &pb.Call{}
	if err := proto.Unmarshal(b, req); err != nil {
		t.logger.Warn(
			"rpc transport dropped malformed frame",
			zap.Int("length", len(b)),
			zap.Error(err),
		)
		return nil
	}

	call := NewCallIn(t.ctx, req, t.calls.Accessor(req.ParentId), t.send)
	call.frameBytes = len(b)

	t.calls.SetCallIn(req.Id, call)
	t.dispatcher.Dispatch(call, func() { t.calls.DeleteCallIn(req.Id) })
	return nil
}

// close cancels incoming calls, fails pending outgoing calls with
// ErrTransportClosed and closes ReadWriter if it is an io.Closer. Only the
// first call has an effect; concurrent calls return once it has finished.
func (t *RWTransport) close(cause error) {
	t.closeOnce.Do(func() {
		err := transportClosedError(cause)

		t.cancel()
		for _, call := range t.calls.closeCallsOut(err) {
			call.fail(err)
		}

		if c, ok := t.rw.(io.Closer); ok {
			if err := c.Close(); err != nil {
				t.logger.Debug("rpc transport failed to close ReadWriter", zap.Error(err))
			}
		}
	})
}

// closedErr returns the error for calls made after the transport stopped, or
// nil if it hasn't.
func (t *RWTransport) closedErr() error {
	if err := t.calls.closedErr(); err != nil {
		return err
	}
	if err := t.ctx.Err(); err != nil {
		return transportClosedError(err)
	}
	return nil
}

func (t *RWTransport) send(ctx context.Context, call *pb.Call) error {
	if err := t.closedErr(); err != nil {
		return err
	}

	b := bufPool.Get().([]byte)[:0]
	b, err := marshalAppendLengthDelimited(b, call)
	defer bufPool.Put(b)
	if err != nil {
		return err
	}

	t.writeLock.Lock()
	defer t.writeLock.Unlock()

	// After a stop, report ErrTransportClosed rather than the writer's error.
	if err := t.closedErr(); err != nil {
		return err
	}
	if _, err := t.rw.Write(b); err != nil {
		if cerr := t.closedErr(); cerr != nil {
			return cerr
		}
		return err
	}

	return nil
}

// Call ...
func (t *RWTransport) Call(call *CallOut, fn ResponseFunc) error {
	defer call.Cancel()

	if err := t.closedErr(); err != nil {
		return err
	}

	call.setMaxQueueBytes(t.maxStreamBufferBytes)
	if err := t.calls.SetCallOut(call.ID(), call); err != nil {
		return err
	}
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
	closeErr     error // guarded by callsOutLock
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

// DeleteCallIn may be called more than once for the same id.
func (m *rwParentCallMap) DeleteCallIn(id uint64) {
	m.callsInLock.Lock()
	defer m.callsInLock.Unlock()
	delete(m.callsIn, id)
}

// SetCallOut registers c, or returns the close error if the transport has
// stopped.
func (m *rwParentCallMap) SetCallOut(id uint64, c *CallOut) error {
	m.callsOutLock.Lock()
	defer m.callsOutLock.Unlock()
	if m.closeErr != nil {
		return m.closeErr
	}
	m.callsOut[id] = c
	return nil
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

// closeCallsOut records err as the close error, so that SetCallOut refuses
// new calls, and returns the calls registered so far.
func (m *rwParentCallMap) closeCallsOut(err error) []*CallOut {
	m.callsOutLock.Lock()
	defer m.callsOutLock.Unlock()
	m.closeErr = err
	calls := make([]*CallOut, 0, len(m.callsOut))
	for _, c := range m.callsOut {
		calls = append(calls, c)
	}
	return calls
}

func (m *rwParentCallMap) closedErr() error {
	m.callsOutLock.Lock()
	defer m.callsOutLock.Unlock()
	return m.closeErr
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
