package rpc

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	pb "github.com/MemeLabs/protobuf/pkg/apis/rpc"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
	"google.golang.org/protobuf/proto"
)

// Package-level identifiers in this file start with cli (or TestCli) so they
// don't collide with the server tests in this package.

type cliDispatcherFunc func(*CallIn, func())

func (f cliDispatcherFunc) Dispatch(c *CallIn, done func()) { f(c, done) }

// cliSplitWriter writes each frame in two halves with a yield between them,
// like a buffered or chunking writer that isn't atomic per Write.
type cliSplitWriter struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (w *cliSplitWriter) Read([]byte) (int, error) { return 0, io.EOF }

func (w *cliSplitWriter) Write(p []byte) (int, error) {
	h := len(p) / 2
	w.mu.Lock()
	w.buf.Write(p[:h])
	w.mu.Unlock()
	runtime.Gosched()
	w.mu.Lock()
	w.buf.Write(p[h:])
	w.mu.Unlock()
	return len(p), nil
}

func TestCliConcurrentSendFramesIntact(t *testing.T) {
	const senders, sends = 50, 20

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	w := &cliSplitWriter{}
	tr, err := (&RWDialer{ReadWriter: w}).Dial(ctx, cliDispatcherFunc(func(_ *CallIn, done func()) { done() }))
	if err != nil {
		t.Fatal(err)
	}
	rwt := tr.(*RWTransport)

	var wg sync.WaitGroup
	for i := 0; i < senders; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < sends; j++ {
				call := &pb.Call{
					Id:       uint64(i*sends + j + 1),
					Method:   fmt.Sprintf("method-%d-%d", i, j),
					Argument: bytes.Repeat([]byte{byte(i)}, 64),
				}
				if err := rwt.send(context.Background(), call); err != nil {
					t.Error(err)
					return
				}
			}
		}()
	}
	wg.Wait()

	seen := map[string]bool{}
	r := bytes.NewReader(w.buf.Bytes())
	for r.Len() > 0 {
		l, err := binary.ReadUvarint(r)
		if err != nil {
			t.Fatalf("frame %d: reading length: %v", len(seen), err)
		}
		b := make([]byte, l)
		if _, err := io.ReadFull(r, b); err != nil {
			t.Fatalf("frame %d: reading body: %v", len(seen), err)
		}
		var call pb.Call
		if err := proto.Unmarshal(b, &call); err != nil {
			t.Fatalf("frame %d: interleaved writes: %v", len(seen), err)
		}
		if seen[call.Method] {
			t.Fatalf("frame %q seen twice", call.Method)
		}
		seen[call.Method] = true
	}
	if len(seen) != senders*sends {
		t.Fatalf("decoded %d frames, want %d", len(seen), senders*sends)
	}
}

// Listen returns promptly when its context is cancelled, closing the
// ReadWriter if it can and discarding whatever is read afterwards if not.
func TestCliListenReturnsOnCancel(t *testing.T) {
	t.Run("closer", func(t *testing.T) {
		a, _ := cliNewPipePair(t)
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		tr, err := (&RWDialer{ReadWriter: a}).Dial(ctx, cliDispatcherFunc(func(_ *CallIn, done func()) { done() }))
		if err != nil {
			t.Fatal(err)
		}
		errc := make(chan error, 1)
		go func() { errc <- tr.Listen() }()

		time.Sleep(20 * time.Millisecond)
		cancel()
		if err := cliWaitErr(t, errc, time.Second, "Listen"); !errors.Is(err, context.Canceled) {
			t.Fatalf("Listen returned %v, want context.Canceled", err)
		}
		if n := a.closes.Load(); n != 1 {
			t.Fatalf("ReadWriter closed %d times, want 1", n)
		}

		call, err := NewCallOut(context.Background(), "m", &pb.Error{})
		if err != nil {
			t.Fatal(err)
		}
		err = tr.Call(call, func() error {
			t.Error("response func ran on a stopped transport")
			return nil
		})
		if !errors.Is(err, ErrTransportClosed) {
			t.Fatalf("Call after stop returned %v, want ErrTransportClosed", err)
		}
	})

	t.Run("non-closer", func(t *testing.T) {
		a, b := cliNewPipePair(t)
		rw := struct {
			io.Reader
			io.Writer
		}{a.r, a.w}
		var dispatched atomic.Int32
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		tr, err := (&RWDialer{ReadWriter: rw}).Dial(ctx, cliDispatcherFunc(func(_ *CallIn, done func()) {
			dispatched.Add(1)
			done()
		}))
		if err != nil {
			t.Fatal(err)
		}
		errc := make(chan error, 1)
		go func() { errc <- tr.Listen() }()

		time.Sleep(20 * time.Millisecond)
		cancel()
		if err := cliWaitErr(t, errc, time.Second, "Listen"); !errors.Is(err, context.Canceled) {
			t.Fatalf("Listen returned %v, want context.Canceled", err)
		}

		// The read goroutine is still blocked in Read. What it reads now is
		// discarded.
		frame, err := marshalAppendLengthDelimited(nil, &pb.Call{Id: 1, Method: "late"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := b.Write(frame); err != nil {
			t.Fatal(err)
		}
		time.Sleep(50 * time.Millisecond)
		if n := dispatched.Load(); n != 0 {
			t.Fatalf("%d frames dispatched after the transport stopped", n)
		}
	})
}

// Listen waits for a dispatch in progress, so nothing is dispatched after it
// returns.
func TestCliListenWaitsForDispatch(t *testing.T) {
	a, b := cliNewPipePair(t)
	entered := make(chan struct{})
	release := make(chan struct{})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	tr, err := (&RWDialer{ReadWriter: a}).Dial(ctx, cliDispatcherFunc(func(_ *CallIn, done func()) {
		close(entered)
		<-release
		done()
	}))
	if err != nil {
		t.Fatal(err)
	}
	errc := make(chan error, 1)
	go func() { errc <- tr.Listen() }()

	frame, err := marshalAppendLengthDelimited(nil, &pb.Call{Id: 1, Method: "m"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := b.Write(frame); err != nil {
		t.Fatal(err)
	}
	cliWaitClosed(t, entered, time.Second, "frame was not dispatched")

	cancel()
	select {
	case err := <-errc:
		t.Fatalf("Listen returned %v while a dispatch was in progress", err)
	case <-time.After(50 * time.Millisecond):
	}
	close(release)
	if err := cliWaitErr(t, errc, time.Second, "Listen"); !errors.Is(err, context.Canceled) {
		t.Fatalf("Listen returned %v, want context.Canceled", err)
	}
}

var cliErrRWClosed = errors.New("cliBlockingRW: closed")

// cliBlockingRW blocks Read and Write until it is closed; then both fail.
type cliBlockingRW struct {
	once   sync.Once
	closed chan struct{}
}

func (b *cliBlockingRW) Read([]byte) (int, error) {
	<-b.closed
	return 0, cliErrRWClosed
}

func (b *cliBlockingRW) Write([]byte) (int, error) {
	<-b.closed
	return 0, cliErrRWClosed
}

func (b *cliBlockingRW) Close() error {
	b.once.Do(func() { close(b.closed) })
	return nil
}

// Calls blocked writing their request, or waiting to, when the client closes
// used to return the writer's error rather than ErrTransportClosed.
func TestCliSendBlockedAtCloseFails(t *testing.T) {
	const n = 3
	client, err := NewClient(zap.NewNop(), &RWDialer{ReadWriter: &cliBlockingRW{closed: make(chan struct{})}})
	if err != nil {
		t.Fatal(err)
	}
	errc := make(chan error, n)
	for i := 0; i < n; i++ {
		go func() { errc <- client.CallUnary(context.Background(), "m", &pb.Error{}, &pb.Error{}) }()
	}

	// Calls register before sending, so once all are registered they are
	// writing or waiting to.
	tr := client.transport.(*RWTransport)
	if !cliEventually(time.Second, func() bool {
		_, out := cliCallMapLens(tr)
		return out == n
	}) {
		t.Fatal("calls were not registered")
	}
	time.Sleep(10 * time.Millisecond)
	client.Close()

	for i := 0; i < n; i++ {
		if err := cliWaitErr(t, errc, time.Second, "CallUnary"); !errors.Is(err, ErrTransportClosed) {
			t.Errorf("call returned %v, want ErrTransportClosed", err)
		}
	}
}

type cliFlushPipe struct{ *cliPipeRW }

func (cliFlushPipe) Flush() error { return nil }

func TestCliRWFDialerClosesReadWriter(t *testing.T) {
	a, _ := cliNewPipePair(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	tr, err := (&RWFDialer{ReadWriteFlusher: cliFlushPipe{a}}).Dial(ctx, cliDispatcherFunc(func(_ *CallIn, done func()) { done() }))
	if err != nil {
		t.Fatal(err)
	}
	errc := make(chan error, 1)
	go func() { errc <- tr.Listen() }()

	cancel()
	cliWaitErr(t, errc, time.Second, "Listen")
	if n := a.closes.Load(); n != 1 {
		t.Fatalf("ReadWriteFlusher closed %d times, want 1", n)
	}
}

// A complete frame that doesn't decode is logged and skipped, and the
// connection keeps working in both directions.
func TestCliMalformedFrameSkipped(t *testing.T) {
	core, logs := observer.New(zap.DebugLevel)
	c := cliNewConn(t, func(d *ServiceDispatcher) {
		d.RegisterMethod("unary", cliUnary)
	}, func(d *RWDialer) {
		d.Logger = zap.New(core)
	})

	garbage := []byte{0xff, 0xff, 0xff} // a truncated tag varint
	if err := proto.Unmarshal(garbage, &pb.Call{}); err == nil {
		t.Fatal("garbage frame decodes")
	}
	frame := append(binary.AppendUvarint(nil, uint64(len(garbage))), garbage...)

	// To the client (observed logger), and to the server (nil Logger).
	for _, tr := range []struct {
		t  *RWTransport
		rw *cliPipeRW
	}{{c.serverT, c.serverRW}, {c.clientT, c.clientRW}} {
		tr.t.writeLock.Lock()
		_, err := tr.rw.Write(frame)
		tr.t.writeLock.Unlock()
		if err != nil {
			t.Fatal(err)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	var res pb.Error
	if err := c.client.CallUnary(ctx, "unary", &pb.Error{}, &res); err != nil {
		t.Fatalf("call after malformed frames failed: %v", err)
	}
	if res.Message != "pong" {
		t.Fatalf("got response %q", res.Message)
	}

	entries := logs.FilterMessage("rpc transport dropped malformed frame").All()
	if len(entries) != 1 {
		t.Fatalf("logged %d malformed frames, want 1", len(entries))
	}
	if l := entries[0].ContextMap()["length"]; l != int64(len(garbage)) {
		t.Fatalf("logged length %v, want %d", l, len(garbage))
	}
}
