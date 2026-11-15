package rpc

import (
	"bytes"
	"context"
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	pb "github.com/MemeLabs/protobuf/pkg/apis/rpc"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
	"google.golang.org/protobuf/proto"
)

// srvHTTPWriter is a ResponseWriter that records writes made after the test
// marked ServeHTTP as returned. delay slows each write down so a premature
// return is caught deterministically.
type srvHTTPWriter struct {
	mu       sync.Mutex
	h        http.Header
	delay    time.Duration
	body     []byte
	writes   int
	returned bool
	late     int
}

func (w *srvHTTPWriter) Header() http.Header { return w.h }
func (w *srvHTTPWriter) WriteHeader(int)     {}

func (w *srvHTTPWriter) Write(p []byte) (int, error) {
	time.Sleep(w.delay)
	w.mu.Lock()
	defer w.mu.Unlock()
	w.writes++
	if w.returned {
		w.late++
	}
	w.body = append(w.body, p...)
	return len(p), nil
}

func (w *srvHTTPWriter) markReturned() []byte {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.returned = true
	return append([]byte(nil), w.body...)
}

func srvHTTPRequest(t *testing.T, ctx context.Context, c *pb.Call) *http.Request {
	t.Helper()
	body, err := marshalAppendLengthDelimited(nil, c)
	if err != nil {
		t.Fatal(err)
	}
	r, err := http.NewRequestWithContext(ctx, "POST", "/", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func srvHTTPDecode(t *testing.T, b []byte) *pb.Call {
	t.Helper()
	l, n := binary.Uvarint(b)
	if n <= 0 || uint64(len(b)-n) < l {
		t.Fatalf("response %x is not a length-delimited frame", b)
	}
	c := &pb.Call{}
	if err := proto.Unmarshal(b[n:n+int(l)], c); err != nil {
		t.Fatal(err)
	}
	return c
}

// srvWaitLog waits until the dispatcher has finished a call for method; the
// "rpc received" entry is logged after the call's final send attempt.
func srvWaitLog(t *testing.T, logs *observer.ObservedLogs, method string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for logs.FilterMessage("rpc received").FilterField(zap.String("method", method)).Len() == 0 {
		if time.Now().After(deadline) {
			t.Fatalf("call %s never finished", method)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestSrvHTTPPanicResponse(t *testing.T) {
	s := NewHTTPServer(zap.NewNop())
	s.RegisterMethod("srv.http.panic", func(ctx context.Context, req *pb.Error) (*pb.Error, error) {
		panic("boom")
	})

	w := &srvHTTPWriter{h: http.Header{}, delay: 20 * time.Millisecond}
	s.ServeHTTP(w, srvHTTPRequest(t, context.Background(), &pb.Call{Id: 1, Method: "srv.http.panic"}))
	body := w.markReturned()

	if len(body) == 0 {
		t.Fatal("ServeHTTP returned before the error response was written")
	}
	res := srvHTTPDecode(t, body)
	if res.Kind != pb.Call_CALL_KIND_ERROR || res.ParentId != 1 {
		t.Errorf("got kind=%v parent=%d, want ERROR for call 1", res.Kind, res.ParentId)
	}
}

func TestSrvHTTPNoWriteAfterDisconnect(t *testing.T) {
	core, logs := observer.New(zapcore.DebugLevel)
	s := NewHTTPServer(zap.New(core))
	release := make(chan struct{})
	s.RegisterMethod("srv.http.slow", func(ctx context.Context, req *pb.Error) (*pb.Error, error) {
		<-release // ignores ctx, as many handlers do
		return &pb.Error{}, nil
	})

	w := &srvHTTPWriter{h: http.Header{}}
	ctx, cancel := context.WithCancel(context.Background())
	r := srvHTTPRequest(t, ctx, &pb.Call{Id: 1, Method: "srv.http.slow"})
	returned := make(chan struct{})
	go func() {
		defer close(returned)
		s.ServeHTTP(w, r)
		w.markReturned()
	}()

	time.Sleep(10 * time.Millisecond)
	cancel() // client disconnects
	select {
	case <-returned:
	case <-time.After(time.Second):
		close(release)
		t.Fatal("ServeHTTP did not return after the client disconnected")
	}

	close(release)
	srvWaitLog(t, logs, "srv.http.slow")

	w.mu.Lock()
	defer w.mu.Unlock()
	if w.writes != 0 || w.late != 0 {
		t.Errorf("%d writes (%d after ServeHTTP returned), want 0", w.writes, w.late)
	}
}

func TestSrvHTTPCancelReturns(t *testing.T) {
	s := NewHTTPServer(zap.NewNop())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel() // unblocks ServeHTTP if the test fails

	w := httptest.NewRecorder()
	r := srvHTTPRequest(t, ctx, &pb.Call{Id: 2, ParentId: 1, Method: cancelMethod})
	returned := make(chan struct{})
	go func() {
		defer close(returned)
		s.ServeHTTP(w, r)
	}()

	select {
	case <-returned:
	case <-time.After(time.Second):
		t.Fatal("ServeHTTP hung on a CANCEL request")
	}
	if w.Code != http.StatusOK || w.Body.Len() != 0 {
		t.Errorf("got %d with %d byte body, want empty 200", w.Code, w.Body.Len())
	}
}

func TestSrvHTTPSizeCap(t *testing.T) {
	serve := func(s *HTTPServer, body []byte) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		s.ServeHTTP(w, httptest.NewRequest("POST", "/", bytes.NewReader(body)))
		return w
	}
	header := func(l uint64) []byte { return binary.AppendUvarint(nil, l) }

	s := NewHTTPServer(zap.NewNop())
	s.RegisterMethod("srv.http.echo", func(ctx context.Context, req *pb.Error) (*pb.Error, error) {
		return req, nil
	})

	t.Run("default cap", func(t *testing.T) {
		if w := serve(s, header(defaultMaxMessageBytes+1)); w.Code != http.StatusRequestEntityTooLarge {
			t.Errorf("got %d, want 413", w.Code)
		}
	})

	t.Run("length overflows int", func(t *testing.T) {
		if w := serve(s, header(1<<63)); w.Code != http.StatusRequestEntityTooLarge {
			t.Errorf("got %d, want 413", w.Code)
		}
	})

	t.Run("custom cap", func(t *testing.T) {
		s := NewHTTPServer(zap.NewNop())
		s.MaxMessageBytes = 16
		if w := serve(s, header(17)); w.Code != http.StatusRequestEntityTooLarge {
			t.Errorf("got %d, want 413", w.Code)
		}
		if w := serve(s, append(header(16), make([]byte, 16)...)); w.Code == http.StatusRequestEntityTooLarge {
			t.Errorf("message at the cap was rejected with 413")
		}
	})

	t.Run("within cap", func(t *testing.T) {
		arg, err := proto.Marshal(&pb.Error{Message: "hi"})
		if err != nil {
			t.Fatal(err)
		}
		body, err := marshalAppendLengthDelimited(nil, &pb.Call{Id: 3, Method: "srv.http.echo", Argument: arg})
		if err != nil {
			t.Fatal(err)
		}
		w := serve(s, body)
		if w.Code != http.StatusOK {
			t.Fatalf("got %d (%s), want 200", w.Code, w.Body.String())
		}
		res := srvHTTPDecode(t, w.Body.Bytes())
		out := &pb.Error{}
		if err := proto.Unmarshal(res.Argument, out); err != nil || res.Kind != pb.Call_CALL_KIND_DEFAULT || out.Message != "hi" {
			t.Errorf("got kind=%v message=%q (%v), want DEFAULT \"hi\"", res.Kind, out.Message, err)
		}
	})
}
