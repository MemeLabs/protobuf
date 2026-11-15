package rpc

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	pb "github.com/MemeLabs/protobuf/pkg/apis/rpc"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
)

// Package-level identifiers in this file start with cli (or TestCli) so they
// don't collide with the server tests in this package.

// cliPipeRW is one end of a connection made of two os.Pipes. Close closes
// both of this end's files and counts how often it was called.
type cliPipeRW struct {
	r, w   *os.File
	closes atomic.Int32
}

func (p *cliPipeRW) Read(b []byte) (int, error)  { return p.r.Read(b) }
func (p *cliPipeRW) Write(b []byte) (int, error) { return p.w.Write(b) }

func (p *cliPipeRW) Close() error {
	p.closes.Add(1)
	p.r.Close()
	return p.w.Close()
}

// cliNewPipePair returns the two ends of a connection.
func cliNewPipePair(t *testing.T) (*cliPipeRW, *cliPipeRW) {
	t.Helper()
	aR, bW, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	bR, aW, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	a := &cliPipeRW{r: aR, w: aW}
	b := &cliPipeRW{r: bR, w: bW}
	t.Cleanup(func() {
		aR.Close()
		aW.Close()
		bR.Close()
		bW.Close()
	})
	return a, b
}

type cliConn struct {
	client     *Client
	clientT    *RWTransport
	serverT    *RWTransport
	clientRW   *cliPipeRW
	serverRW   *cliPipeRW
	serverDone chan error
}

// cliNewConn connects a Client to a ServiceDispatcher over a pipe pair. The
// server's RWDialer has no Logger, to cover the nil Logger default.
func cliNewConn(t *testing.T, register func(*ServiceDispatcher), dialer func(*RWDialer)) *cliConn {
	t.Helper()
	logger := zap.NewNop()
	clientRW, serverRW := cliNewPipePair(t)

	disp := NewServiceDispatcher(logger)
	if register != nil {
		register(disp)
	}
	sctx, scancel := context.WithCancel(context.Background())
	st, err := (&RWDialer{ReadWriter: serverRW}).Dial(sctx, disp)
	if err != nil {
		t.Fatal(err)
	}
	serverDone := make(chan error, 1)
	go func() { serverDone <- st.Listen() }()

	d := &RWDialer{Logger: logger, ReadWriter: clientRW}
	if dialer != nil {
		dialer(d)
	}
	client, err := NewClient(logger, d)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		client.Close()
		scancel()
	})

	return &cliConn{
		client:     client,
		clientT:    client.transport.(*RWTransport),
		serverT:    st.(*RWTransport),
		clientRW:   clientRW,
		serverRW:   serverRW,
		serverDone: serverDone,
	}
}

func cliCallMapLens(tr *RWTransport) (int, int) {
	tr.calls.callsInLock.Lock()
	in := len(tr.calls.callsIn)
	tr.calls.callsInLock.Unlock()
	tr.calls.callsOutLock.Lock()
	out := len(tr.calls.callsOut)
	tr.calls.callsOutLock.Unlock()
	return in, out
}

// cliStreamer returns a streaming handler that sends n messages (forever if
// n < 0), numbered by Code, sleeping every between them. It closes cancelled,
// if not nil, when its context is cancelled.
func cliStreamer(n int, every time.Duration, cancelled chan struct{}) func(ctx context.Context, req *pb.Error) (<-chan *pb.Error, error) {
	return func(ctx context.Context, req *pb.Error) (<-chan *pb.Error, error) {
		ch := make(chan *pb.Error)
		go func() {
			defer close(ch)
			for i := 0; n < 0 || i < n; i++ {
				select {
				case ch <- &pb.Error{Message: "tick", Code: int32(i)}:
				case <-ctx.Done():
					if cancelled != nil {
						close(cancelled)
					}
					return
				}
				if every > 0 {
					time.Sleep(every)
				}
			}
		}()
		return ch, nil
	}
}

func cliUnary(ctx context.Context, req *pb.Error) (*pb.Error, error) {
	return &pb.Error{Message: "pong"}, nil
}

// cliBlock returns a unary handler that waits for its context to be done and
// then closes cancelled, if not nil.
func cliBlock(cancelled chan struct{}) func(ctx context.Context, req *pb.Error) (*pb.Error, error) {
	return func(ctx context.Context, req *pb.Error) (*pb.Error, error) {
		<-ctx.Done()
		if cancelled != nil {
			close(cancelled)
		}
		return nil, ctx.Err()
	}
}

func cliWaitErr(t *testing.T, errc <-chan error, d time.Duration, what string) error {
	t.Helper()
	select {
	case err := <-errc:
		return err
	case <-time.After(d):
		t.Fatalf("%s did not return within %s", what, d)
		return nil
	}
}

func cliWaitClosed(t *testing.T, ch <-chan struct{}, d time.Duration, what string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(d):
		t.Fatalf("%s within %s", what, d)
	}
}

func cliEventually(d time.Duration, cond func() bool) bool {
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if cond() {
			return true
		}
		time.Sleep(5 * time.Millisecond)
	}
	return cond()
}

// cliFindCallOut waits for tr to have exactly one pending outgoing call and
// returns it.
func cliFindCallOut(t *testing.T, tr *RWTransport) *CallOut {
	t.Helper()
	var call *CallOut
	if !cliEventually(time.Second, func() bool {
		tr.calls.callsOutLock.Lock()
		defer tr.calls.callsOutLock.Unlock()
		if len(tr.calls.callsOut) != 1 {
			return false
		}
		for _, c := range tr.calls.callsOut {
			call = c
		}
		return true
	}) {
		t.Fatal("no single pending call")
	}
	return call
}

// cliSilentStream is a streaming handler that never sends.
func cliSilentStream(ctx context.Context, req *pb.Error) (<-chan *pb.Error, error) {
	return make(chan *pb.Error), nil
}

func cliCallUnary(c *Client, method string, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return c.CallUnary(ctx, method, &pb.Error{}, &pb.Error{})
}

// Making unary calls on the same client from inside a stream's receive loop
// used to deadlock: the read loop blocked handing the next stream message to
// the stream's reader, so the unary response was never read.
func TestCliStreamConsumerCallsUnary(t *testing.T) {
	c := cliNewConn(t, func(d *ServiceDispatcher) {
		d.RegisterMethod("stream", cliStreamer(1000, 0, nil))
		d.RegisterMethod("unary", cliUnary)
	}, nil)

	ch := make(chan *pb.Error)
	errc := make(chan error, 1)
	go func() { errc <- c.client.CallStreaming(context.Background(), "stream", &pb.Error{}, ch) }()

	n := 0
	for range ch {
		if n < 20 {
			if err := cliCallUnary(c.client, "unary", 2*time.Second); err != nil {
				t.Fatalf("unary call %d from the stream consumer failed: %v", n, err)
			}
		}
		n++
	}
	if err := cliWaitErr(t, errc, time.Second, "CallStreaming"); err != nil {
		t.Fatalf("CallStreaming returned %v", err)
	}
	if n != 1000 {
		t.Fatalf("received %d messages, want 1000", n)
	}
}

// A stream consumer that stops reading must not delay other calls on the
// connection.
func TestCliSlowStreamDoesNotStallConn(t *testing.T) {
	cancelled := make(chan struct{})
	c := cliNewConn(t, func(d *ServiceDispatcher) {
		d.RegisterMethod("stream", cliStreamer(-1, time.Millisecond, cancelled))
		d.RegisterMethod("unary", cliUnary)
	}, nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ch := make(chan *pb.Error)
	errc := make(chan error, 1)
	go func() { errc <- c.client.CallStreaming(ctx, "stream", &pb.Error{}, ch) }()
	<-ch                              // then stop reading
	time.Sleep(50 * time.Millisecond) // and let the stream back up

	for i := 0; i < 10; i++ {
		if err := cliCallUnary(c.client, "unary", time.Second); err != nil {
			t.Fatalf("unary call %d failed while a stream consumer was parked: %v", i, err)
		}
	}

	cancel()
	if err := cliWaitErr(t, errc, time.Second, "CallStreaming"); !errors.Is(err, context.Canceled) {
		t.Fatalf("CallStreaming returned %v, want context.Canceled", err)
	}
	cliWaitClosed(t, cancelled, time.Second, "server handler was not cancelled")
}

// A consumer that cancels and then stops reading used to leave CallStreaming
// stuck sending to it, so the cancel was never forwarded.
func TestCliStreamCancelWithoutDraining(t *testing.T) {
	cancelled := make(chan struct{})
	c := cliNewConn(t, func(d *ServiceDispatcher) {
		// Send messages 0, 1 and 2, then wait to be cancelled.
		d.RegisterMethod("stream", func(ctx context.Context, req *pb.Error) (<-chan *pb.Error, error) {
			ch := make(chan *pb.Error)
			go func() {
				defer close(cancelled)
				for i := 0; i < 3; i++ {
					select {
					case ch <- &pb.Error{Message: "tick", Code: int32(i)}:
					case <-ctx.Done():
						return
					}
				}
				<-ctx.Done()
			}()
			return ch, nil
		})
	}, nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ch := make(chan *pb.Error)
	errc := make(chan error, 1)
	go func() { errc <- c.client.CallStreaming(ctx, "stream", &pb.Error{}, ch) }()
	<-ch // message 0, then ch is never read again

	// Once message 2 is the only one queued, CallStreaming has taken message
	// 1 and is waiting to send it to ch.
	call := cliFindCallOut(t, c.clientT)
	if !cliEventually(time.Second, func() bool {
		call.mu.Lock()
		defer call.mu.Unlock()
		if len(call.queue) != 1 {
			return false
		}
		var m pb.Error
		return proto.Unmarshal(call.queue[0].req.Argument, &m) == nil && m.Code == 2
	}) {
		t.Fatal("CallStreaming never took message 1")
	}
	cancel()

	if err := cliWaitErr(t, errc, time.Second, "CallStreaming"); !errors.Is(err, context.Canceled) {
		t.Fatalf("CallStreaming returned %v, want context.Canceled", err)
	}
	cliWaitClosed(t, cancelled, time.Second, "server handler was not cancelled")
}

// A regression guard for the per-call queue rather than a repro: per-call
// message order must survive a consumer of uneven speed.
func TestCliStreamOrder(t *testing.T) {
	const n = 2000
	c := cliNewConn(t, func(d *ServiceDispatcher) {
		d.RegisterMethod("stream", cliStreamer(n, 0, nil))
	}, nil)

	ch := make(chan *pb.Error)
	errc := make(chan error, 1)
	go func() { errc <- c.client.CallStreaming(context.Background(), "stream", &pb.Error{}, ch) }()

	var got []int32
	for m := range ch {
		got = append(got, m.Code)
		if len(got)%100 == 0 {
			time.Sleep(time.Duration(rand.IntN(3)) * time.Millisecond)
		}
	}
	if err := cliWaitErr(t, errc, time.Second, "CallStreaming"); err != nil {
		t.Fatalf("CallStreaming returned %v", err)
	}
	if len(got) != n {
		t.Fatalf("received %d messages, want %d", len(got), n)
	}
	for i, code := range got {
		if code != int32(i) {
			t.Fatalf("message %d has index %d", i, code)
		}
	}
}

// A consumer that falls too far behind fails only its own call, and the
// cancel is forwarded to the server.
func TestCliStreamOverflow(t *testing.T) {
	cancelled := make(chan struct{})
	c := cliNewConn(t, func(d *ServiceDispatcher) {
		d.RegisterMethod("stream", cliStreamer(-1, 0, cancelled))
		d.RegisterMethod("unary", cliUnary)
	}, func(d *RWDialer) {
		d.MaxStreamBufferBytes = 1
	})

	ch := make(chan *pb.Error) // never read
	errc := make(chan error, 1)
	go func() { errc <- c.client.CallStreaming(context.Background(), "stream", &pb.Error{}, ch) }()

	if err := cliWaitErr(t, errc, 2*time.Second, "CallStreaming"); !errors.Is(err, ErrStreamBufferFull) {
		t.Fatalf("CallStreaming returned %v, want ErrStreamBufferFull", err)
	}
	cliWaitClosed(t, cancelled, time.Second, "server handler was not cancelled")

	// A unary response never overflows: the limit only applies to a backlog.
	if err := cliCallUnary(c.client, "unary", time.Second); err != nil {
		t.Fatalf("unary call after the overflow failed: %v", err)
	}
	if !cliEventually(time.Second, func() bool {
		in, out := cliCallMapLens(c.clientT)
		return in == 0 && out == 0
	}) {
		in, out := cliCallMapLens(c.clientT)
		t.Fatalf("client callsIn=%d callsOut=%d, want 0", in, out)
	}
}

// Calls pending when the peer goes away fail promptly, even without a
// deadline.
func TestCliPendingCallFailsOnDisconnect(t *testing.T) {
	c := cliNewConn(t, func(d *ServiceDispatcher) {
		d.RegisterMethod("block", cliBlock(nil))
		d.RegisterMethod("stream", cliStreamer(-1, time.Millisecond, nil))
	}, nil)

	unaryErr := make(chan error, 1)
	go func() {
		unaryErr <- c.client.CallUnary(context.Background(), "block", &pb.Error{}, &pb.Error{})
	}()
	ch := make(chan *pb.Error)
	streamErr := make(chan error, 1)
	go func() { streamErr <- c.client.CallStreaming(context.Background(), "stream", &pb.Error{}, ch) }()
	go func() {
		for range ch {
		}
	}()

	time.Sleep(50 * time.Millisecond)
	c.serverRW.Close() // the peer goes away

	for name, errc := range map[string]chan error{"CallUnary": unaryErr, "CallStreaming": streamErr} {
		err := cliWaitErr(t, errc, time.Second, name)
		if !errors.Is(err, ErrTransportClosed) || !strings.Contains(err.Error(), "EOF") {
			t.Errorf("%s returned %v, want ErrTransportClosed caused by EOF", name, err)
		}
	}
}

// Close fails pending and later calls, closes the ReadWriter, and the server
// cancels its in-flight handlers when it reads EOF.
func TestCliCloseFailsCalls(t *testing.T) {
	handlerCancelled := make(chan struct{})
	c := cliNewConn(t, func(d *ServiceDispatcher) {
		d.RegisterMethod("block", cliBlock(handlerCancelled))
		d.RegisterMethod("stream", cliStreamer(-1, time.Millisecond, nil))
	}, nil)

	unaryErr := make(chan error, 1)
	go func() {
		unaryErr <- c.client.CallUnary(context.Background(), "block", &pb.Error{}, &pb.Error{})
	}()
	ch := make(chan *pb.Error)
	streamErr := make(chan error, 1)
	go func() { streamErr <- c.client.CallStreaming(context.Background(), "stream", &pb.Error{}, ch) }()
	go func() {
		for range ch {
		}
	}()

	time.Sleep(50 * time.Millisecond)
	c.client.Close()

	for name, errc := range map[string]chan error{"CallUnary": unaryErr, "CallStreaming": streamErr} {
		if err := cliWaitErr(t, errc, time.Second, name); !errors.Is(err, ErrTransportClosed) {
			t.Errorf("%s returned %v, want ErrTransportClosed", name, err)
		}
	}

	start := time.Now()
	err := c.client.CallUnary(context.Background(), "block", &pb.Error{}, &pb.Error{})
	if !errors.Is(err, ErrTransportClosed) {
		t.Errorf("call after Close returned %v, want ErrTransportClosed", err)
	}
	if d := time.Since(start); d > 100*time.Millisecond {
		t.Errorf("call after Close took %s", d)
	}

	if !cliEventually(time.Second, func() bool { return c.clientRW.closes.Load() == 1 }) {
		t.Errorf("client ReadWriter closed %d times, want 1", c.clientRW.closes.Load())
	}

	cliWaitClosed(t, handlerCancelled, time.Second, "server handler was not cancelled after the client closed")
	if err := cliWaitErr(t, c.serverDone, time.Second, "server Listen"); err == nil {
		t.Error("server Listen returned nil")
	}
}

// Callbacks that arrive after their call returned, and frames that aren't
// callbacks, must not stay in the client's call map.
func TestCliLateCallbackNoLeak(t *testing.T) {
	c := cliNewConn(t, func(d *ServiceDispatcher) {
		d.RegisterMethod("slow", func(ctx context.Context, req *pb.Error) (*pb.Error, error) {
			time.Sleep(100 * time.Millisecond) // ignores ctx, as many handlers do
			return &pb.Error{}, nil
		})
		d.RegisterMethod("unary", cliUnary)
	}, nil)

	for i := 0; i < 5; i++ {
		if err := cliCallUnary(c.client, "slow", 10*time.Millisecond); !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("call %d returned %v, want context.DeadlineExceeded", i, err)
		}
	}
	time.Sleep(300 * time.Millisecond) // the late responses arrive

	// Frames the client doesn't serve, and a callback for an unknown call.
	for _, call := range []*pb.Call{
		{Id: 1 << 40, Method: "unsolicited"},
		{Id: 1<<40 + 1, ParentId: 1 << 50, Method: cancelMethod},
		{Id: 1<<40 + 2, ParentId: 1 << 50, Method: callbackMethod},
	} {
		if err := c.serverT.send(context.Background(), call); err != nil {
			t.Fatal(err)
		}
	}
	// Frames are handled in order, so these have been dispatched once the
	// response to this call has.
	if err := cliCallUnary(c.client, "unary", time.Second); err != nil {
		t.Fatal(err)
	}

	if !cliEventually(time.Second, func() bool {
		in, out := cliCallMapLens(c.clientT)
		return in == 0 && out == 0
	}) {
		in, out := cliCallMapLens(c.clientT)
		t.Fatalf("client callsIn=%d callsOut=%d, want 0", in, out)
	}
}

type cliNoParent struct{}

func (cliNoParent) ParentCallIn() *CallIn   { return nil }
func (cliNoParent) ParentCallOut() *CallOut { return nil }

// Internal reads of the lazily created context used to race with a
// concurrent Cancel, e.g. a "method not found" reply racing a CANCEL frame.
// It only detects the race when run with -race.
func TestCliCallBaseCancelRace(t *testing.T) {
	nopSend := func(context.Context, *pb.Call) error { return nil }

	for i := 0; i < 100; i++ {
		in := NewCallIn(context.Background(), &pb.Call{Id: 1, Method: "missing"}, cliNoParent{}, nopSend)
		out, err := NewCallOut(context.Background(), "m", &pb.Error{})
		if err != nil {
			t.Fatal(err)
		}

		var wg sync.WaitGroup
		wg.Add(4)
		go func() {
			defer wg.Done()
			in.returnError(errors.New("method not found"))
		}()
		go func() {
			defer wg.Done()
			in.Cancel()
		}()
		go func() {
			defer wg.Done()
			out.SendRequest(nopSend)
		}()
		go func() {
			defer wg.Done()
			out.Cancel()
		}()
		wg.Wait()

		if in.ResponseType() != ResponseTypeError {
			t.Fatalf("response type %s, want ERROR", in.ResponseType())
		}
		if in.Context().Err() == nil || out.Context().Err() == nil {
			t.Fatal("call context not cancelled")
		}
	}
}

func TestCliErrorMessages(t *testing.T) {
	err := transportClosedError(errors.New("EOF"))
	if !errors.Is(err, ErrTransportClosed) || err.Error() != "rpc: transport closed: EOF" {
		t.Errorf("got %q", err)
	}
	if errors.Is(transportClosedError(context.Canceled), context.Canceled) {
		t.Error("transport closed error must not match context.Canceled")
	}
}

// The buffer limit charges a response's whole frame. It used to charge only
// the argument, so frames with large headers were held far past the limit.
func TestCliStreamBufferCountsWholeFrame(t *testing.T) {
	c := cliNewConn(t, func(d *ServiceDispatcher) {
		d.RegisterMethod("silent", cliSilentStream)
	}, func(d *RWDialer) {
		d.MaxStreamBufferBytes = 1 << 20
	})

	ch := make(chan *pb.Error) // never read
	errc := make(chan error, 1)
	go func() { errc <- c.client.CallStreaming(context.Background(), "silent", &pb.Error{}, ch) }()
	call := cliFindCallOut(t, c.clientT)

	// 20 frames of 100 KiB, each with a tiny argument.
	hdr := map[string][]byte{"h": make([]byte, 100<<10)}
	arg, err := proto.Marshal(&pb.Error{Message: "x"})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 20; i++ {
		res := &pb.Call{Id: uint64(1<<40 + i), ParentId: call.ID(), Method: callbackMethod, Argument: arg, Headers: hdr}
		if err := c.serverT.send(context.Background(), res); err != nil {
			t.Fatal(err)
		}
	}

	if err := cliWaitErr(t, errc, 2*time.Second, "CallStreaming"); !errors.Is(err, ErrStreamBufferFull) {
		t.Fatalf("CallStreaming returned %v, want ErrStreamBufferFull", err)
	}
}

// A CallOut used with a Transport other than RWTransport is bounded too.
func TestCliCallOutDefaultBufferLimit(t *testing.T) {
	fill := func(call *CallOut) {
		for i := 0; i < 20 && call.failure() == nil; i++ {
			call.AssignResponse(&CallIn{req: &pb.Call{Id: uint64(i)}, frameBytes: 1 << 20})
		}
	}

	call, err := NewCallOut(context.Background(), "m", &pb.Error{})
	if err != nil {
		t.Fatal(err)
	}
	fill(call)
	if err := call.failure(); !errors.Is(err, ErrStreamBufferFull) {
		t.Fatalf("20 MiB queued with the default limit: got %v, want ErrStreamBufferFull", err)
	}

	unbounded, err := NewCallOut(context.Background(), "m", &pb.Error{})
	if err != nil {
		t.Fatal(err)
	}
	unbounded.setMaxQueueBytes(-1)
	fill(unbounded)
	if err := unbounded.failure(); err != nil {
		t.Fatalf("unbounded call failed: %v", err)
	}
}

func TestCliShouldForwardCancel(t *testing.T) {
	for _, tc := range []struct {
		err  error
		want bool
	}{
		{nil, false},
		{ErrClose, false},
		{transportClosedError(errors.New("EOF")), false},
		{&pb.Error{Message: "server error"}, false},
		{context.Canceled, true},
		{context.DeadlineExceeded, true},
		{ErrStreamBufferFull, true},
		{ErrInvalidType, true},
		{proto.Unmarshal([]byte{0x0a, 0x01, 0xff}, &pb.Error{}), true},
	} {
		if got := shouldForwardCancel(tc.err); got != tc.want {
			t.Errorf("shouldForwardCancel(%v) = %v, want %v", tc.err, got, tc.want)
		}
	}
}

// A stream that ends because a response fails to decode on the client used
// to forward no CANCEL, so the server kept streaming.
func TestCliDecodeErrorForwardsCancel(t *testing.T) {
	cancelled := make(chan struct{})
	c := cliNewConn(t, func(d *ServiceDispatcher) {
		d.RegisterMethod("stream", cliStreamer(-1, time.Millisecond, cancelled))
	}, nil)

	ch := make(chan *pb.Error)
	errc := make(chan error, 1)
	go func() { errc <- c.client.CallStreaming(context.Background(), "stream", &pb.Error{}, ch) }()
	<-ch
	call := cliFindCallOut(t, c.clientT)

	// pb.Error.Message (field 1) holding invalid UTF-8.
	bad := &pb.Call{Id: 1 << 41, ParentId: call.ID(), Method: callbackMethod, Argument: []byte{0x0a, 0x01, 0xff}}
	if err := c.serverT.send(context.Background(), bad); err != nil {
		t.Fatal(err)
	}
	go func() {
		for range ch {
		}
	}()

	err := cliWaitErr(t, errc, time.Second, "CallStreaming")
	if err == nil || errors.Is(err, ErrTransportClosed) {
		t.Fatalf("CallStreaming returned %v, want a decode error", err)
	}
	cliWaitClosed(t, cancelled, time.Second, "server handler was not cancelled after a decode error")
}

// Responses received before the transport stops are delivered, in order,
// before ErrTransportClosed.
func TestCliQueuedResponsesDeliveredBeforeClose(t *testing.T) {
	const n = 50
	c := cliNewConn(t, func(d *ServiceDispatcher) {
		d.RegisterMethod("silent", cliSilentStream)
	}, nil)

	ch := make(chan *pb.Error)
	errc := make(chan error, 1)
	go func() { errc <- c.client.CallStreaming(context.Background(), "silent", &pb.Error{}, ch) }()
	call := cliFindCallOut(t, c.clientT)

	for i := 0; i < n; i++ {
		arg, err := proto.Marshal(&pb.Error{Code: int32(i)})
		if err != nil {
			t.Fatal(err)
		}
		res := &pb.Call{Id: uint64(1<<42 + i), ParentId: call.ID(), Method: callbackMethod, Argument: arg}
		if err := c.serverT.send(context.Background(), res); err != nil {
			t.Fatal(err)
		}
	}
	c.serverRW.Close()

	got := 0
	for m := range ch {
		if m.Code != int32(got) {
			t.Fatalf("message %d has index %d", got, m.Code)
		}
		got++
		time.Sleep(time.Millisecond)
	}
	if err := cliWaitErr(t, errc, time.Second, "CallStreaming"); got != n || !errors.Is(err, ErrTransportClosed) {
		t.Fatalf("received %d of %d messages, then %v; want all, then ErrTransportClosed", got, n, err)
	}
}

// Every call racing Close returns, with either its result or
// ErrTransportClosed.
func TestCliCloseRace(t *testing.T) {
	for iter := 0; iter < 20; iter++ {
		c := cliNewConn(t, func(d *ServiceDispatcher) {
			d.RegisterMethod("unary", cliUnary)
			d.RegisterMethod("block", cliBlock(nil))
			d.RegisterMethod("stream", cliStreamer(-1, 0, nil))
		}, nil)

		var wg sync.WaitGroup
		errs := make(chan error, 30)
		for i := 0; i < 30; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				switch i % 3 {
				case 0:
					errs <- c.client.CallUnary(context.Background(), "unary", &pb.Error{}, &pb.Error{})
				case 1:
					errs <- c.client.CallUnary(context.Background(), "block", &pb.Error{}, &pb.Error{})
				case 2:
					ch := make(chan *pb.Error, 4)
					go func() {
						for range ch {
						}
					}()
					errs <- c.client.CallStreaming(context.Background(), "stream", &pb.Error{}, ch)
				}
			}()
		}
		time.Sleep(time.Duration(iter%5) * time.Millisecond)
		c.client.Close()

		done := make(chan struct{})
		go func() {
			wg.Wait()
			close(done)
		}()
		cliWaitClosed(t, done, 2*time.Second, fmt.Sprintf("iteration %d: calls still running after Close", iter))
		close(errs)
		for err := range errs {
			if err != nil && !errors.Is(err, ErrTransportClosed) {
				t.Errorf("iteration %d: call returned %v, want nil or ErrTransportClosed", iter, err)
			}
		}
	}
}
