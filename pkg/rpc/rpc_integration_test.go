package rpc

import (
	"context"
	"errors"
	"os"
	"sync/atomic"
	"testing"
	"time"

	pb "github.com/MemeLabs/protobuf/pkg/apis/rpc"
	"go.uber.org/zap"
)

// Package-level identifiers in this file start with integ (or
// TestRPCIntegration) so they don't collide with the cli and srv helpers of
// the client and server tests. These tests run a Client and a
// ServiceDispatcher against each other over a real RWTransport pair.

// integWaitTimeout bounds every wait in this file. Each step takes far less,
// so it only comes into play when something is broken.
const integWaitTimeout = 5 * time.Second

// integPipeEnd is one end of a connection made of two os.Pipes.
type integPipeEnd struct{ r, w *os.File }

func (p *integPipeEnd) Read(b []byte) (int, error)  { return p.r.Read(b) }
func (p *integPipeEnd) Write(b []byte) (int, error) { return p.w.Write(b) }
func (p *integPipeEnd) Close() error                { return errors.Join(p.r.Close(), p.w.Close()) }

func integNewPipePair(t *testing.T) (*integPipeEnd, *integPipeEnd) {
	t.Helper()
	aR, bW, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	bR, aW, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		aR.Close()
		aW.Close()
		bR.Close()
		bW.Close()
	})
	return &integPipeEnd{r: aR, w: aW}, &integPipeEnd{r: bR, w: bW}
}

// integCancelCounter passes frames on to Dispatcher and counts the CANCEL
// frames among them, so a test can check that cancellations really crossed
// the transport.
type integCancelCounter struct {
	Dispatcher
	cancels atomic.Int32
}

func (d *integCancelCounter) Dispatch(call *CallIn, done func()) {
	if call.Method() == cancelMethod {
		d.cancels.Add(1)
	}
	d.Dispatcher.Dispatch(call, done)
}

type integConn struct {
	client  *Client
	clientT *RWTransport
	serverT *RWTransport
	server  *integCancelCounter
}

// integNewConn connects a Client to a ServiceDispatcher, set up by register,
// over a pipe pair. Cleanup closes the client, stops the server and waits for
// its Listen to return.
func integNewConn(t *testing.T, register func(*ServiceDispatcher)) *integConn {
	t.Helper()
	logger := zap.NewNop()
	clientRW, serverRW := integNewPipePair(t)

	sd := NewServiceDispatcher(logger)
	register(sd)
	disp := &integCancelCounter{Dispatcher: sd}

	sctx, scancel := context.WithCancel(context.Background())
	st, err := (&RWDialer{Logger: logger, ReadWriter: serverRW}).Dial(sctx, disp)
	if err != nil {
		scancel()
		t.Fatal(err)
	}
	serverDone := make(chan error, 1)
	go func() { serverDone <- st.Listen() }()
	t.Cleanup(func() {
		scancel()
		select {
		case <-serverDone:
		case <-time.After(integWaitTimeout):
			t.Errorf("server Listen did not return within %s", integWaitTimeout)
		}
	})

	client, err := NewClient(logger, &RWDialer{Logger: logger, ReadWriter: clientRW})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)

	return &integConn{
		client:  client,
		clientT: client.transport.(*RWTransport),
		serverT: st.(*RWTransport),
		server:  disp,
	}
}

func integCallMapLens(tr *RWTransport) (in, out int) {
	tr.calls.callsInLock.Lock()
	in = len(tr.calls.callsIn)
	tr.calls.callsInLock.Unlock()
	tr.calls.callsOutLock.Lock()
	out = len(tr.calls.callsOut)
	tr.calls.callsOutLock.Unlock()
	return in, out
}

func integWait(t *testing.T, ch <-chan struct{}, what string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(integWaitTimeout):
		t.Fatalf("timed out after %s waiting for %s", integWaitTimeout, what)
	}
}

func integWaitErr(t *testing.T, errc <-chan error, what string) error {
	t.Helper()
	select {
	case err := <-errc:
		return err
	case <-time.After(integWaitTimeout):
		t.Fatalf("timed out after %s waiting for %s", integWaitTimeout, what)
		return nil
	}
}

// integEventually polls cond until it holds or integWaitTimeout passes, and
// reports whether it held.
func integEventually(cond func() bool) bool {
	deadline := time.Now().Add(integWaitTimeout)
	for !cond() {
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(time.Millisecond)
	}
	return true
}

// A call the client gives up on, because its context was cancelled mid-stream
// or its deadline passed, makes the client forward a CANCEL frame. Once the
// cancelled calls and their CANCEL frames are finished, neither side's
// RWTransport may still hold an entry for any of them. The server's
// dispatcher used to never call done for CANCEL frames, so the server
// transport kept every one in its callsIn map for the life of the connection.
func TestRPCIntegrationCancelNoLeak(t *testing.T) {
	const n = 10

	// Each handler signals once its context has been cancelled, which only a
	// CANCEL frame from the client does.
	streamCancelled := make(chan struct{}, n)
	blockCancelled := make(chan struct{}, n)
	c := integNewConn(t, func(d *ServiceDispatcher) {
		// stream sends one message and then waits to be cancelled.
		d.RegisterMethod("stream", func(ctx context.Context, _ *pb.Error) (<-chan *pb.Error, error) {
			ch := make(chan *pb.Error)
			go func() {
				defer close(ch)
				select {
				case ch <- &pb.Error{Message: "first"}:
				case <-ctx.Done():
				}
				<-ctx.Done()
				streamCancelled <- struct{}{}
			}()
			return ch, nil
		})
		// block waits to be cancelled.
		d.RegisterMethod("block", func(ctx context.Context, _ *pb.Error) (*pb.Error, error) {
			<-ctx.Done()
			blockCancelled <- struct{}{}
			return nil, ctx.Err()
		})
	})

	for i := range n {
		// A stream whose caller cancels it after the first message.
		ctx, cancel := context.WithCancel(context.Background())
		ch := make(chan *pb.Error)
		errc := make(chan error, 1)
		go func() { errc <- c.client.CallStreaming(ctx, "stream", &pb.Error{}, ch) }()
		select {
		case <-ch:
		case err := <-errc:
			cancel()
			t.Fatalf("stream %d: CallStreaming returned %v before the first message", i, err)
		case <-time.After(integWaitTimeout):
			cancel()
			t.Fatalf("stream %d: no message within %s", i, integWaitTimeout)
		}
		cancel()
		if err := integWaitErr(t, errc, "CallStreaming to return"); !errors.Is(err, context.Canceled) {
			t.Fatalf("stream %d: CallStreaming returned %v, want context.Canceled", i, err)
		}
		integWait(t, streamCancelled, "the stream handler to be cancelled")

		// A unary call whose deadline passes while the server is handling it.
		// The request is sent whatever the deadline, so the client always
		// forwards a CANCEL for it.
		uctx, ucancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
		err := c.client.CallUnary(uctx, "block", &pb.Error{}, &pb.Error{})
		ucancel()
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("block %d: CallUnary returned %v, want context.DeadlineExceeded", i, err)
		}
		integWait(t, blockCancelled, "the block handler to be cancelled")
	}

	// Each handler saw its cancellation only after its CANCEL was dispatched,
	// so the count is final.
	if got := c.server.cancels.Load(); got != 2*n {
		t.Errorf("server dispatched %d CANCEL frames, want %d", got, 2*n)
	}

	// The last responses and CANCEL frames may still be finishing, so poll.
	lens := func() (sin, sout, cin, cout int) {
		sin, sout = integCallMapLens(c.serverT)
		cin, cout = integCallMapLens(c.clientT)
		return
	}
	if !integEventually(func() bool {
		sin, sout, cin, cout := lens()
		return sin == 0 && sout == 0 && cin == 0 && cout == 0
	}) {
		sin, sout, cin, cout := lens()
		t.Fatalf("call maps not empty after %s: server in=%d out=%d, client in=%d out=%d",
			integWaitTimeout, sin, sout, cin, cout)
	}
}
