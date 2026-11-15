package rpc

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	pb "github.com/MemeLabs/protobuf/pkg/apis/rpc"
	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
)

// srvRecorder is a SendFunc that records the frames a CallIn sends and
// whether any were sent after the dispatcher called done.
type srvRecorder struct {
	mu          sync.Mutex
	frames      []*pb.Call
	done        bool
	framesAtEnd int
	afterDone   int
}

func (r *srvRecorder) send(_ context.Context, c *pb.Call) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.done {
		r.afterDone++
	}
	// send() reuses the Argument buffer once we return, so keep a copy
	r.frames = append(r.frames, proto.Clone(c).(*pb.Call))
	return nil
}

func (r *srvRecorder) markDone() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.done = true
	r.framesAtEnd = len(r.frames)
}

func (r *srvRecorder) snapshot() (frames []*pb.Call, framesAtEnd, afterDone int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]*pb.Call(nil), r.frames...), r.framesAtEnd, r.afterDone
}

type srvParents struct{ in *CallIn }

func (p srvParents) ParentCallIn() *CallIn   { return p.in }
func (p srvParents) ParentCallOut() *CallOut { return nil }

func srvDispatch(d *ServiceDispatcher, req *pb.Call, parents ParentCallAccessor) (*CallIn, *srvRecorder, <-chan struct{}) {
	rec := &srvRecorder{}
	done := make(chan struct{})
	call := NewCallIn(context.Background(), req, parents, rec.send)
	d.Dispatch(call, func() {
		rec.markDone()
		close(done)
	})
	return call, rec, done
}

func srvWait(t *testing.T, done <-chan struct{}) bool {
	t.Helper()
	select {
	case <-done:
		return true
	case <-time.After(time.Second):
		t.Error("dispatcher did not call done")
		return false
	}
}

func srvCounter(c prometheus.Counter) float64 {
	m := &dto.Metric{}
	if err := c.Write(m); err != nil {
		panic(err)
	}
	return m.GetCounter().GetValue()
}

func srvMarshal(t *testing.T, m proto.Message) []byte {
	t.Helper()
	b, err := proto.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestSrvCancelCallsDone(t *testing.T) {
	d := NewServiceDispatcher(zap.NewNop())

	t.Run("with parent", func(t *testing.T) {
		parent := NewCallIn(context.Background(), &pb.Call{Id: 7, Method: "srv.parent"}, noopParentCallAccessor{}, (&srvRecorder{}).send)
		pctx := parent.Context()
		_, rec, done := srvDispatch(d, &pb.Call{Id: 8, ParentId: 7, Method: cancelMethod}, srvParents{parent})
		if !srvWait(t, done) {
			return
		}
		if pctx.Err() == nil {
			t.Error("parent call was not cancelled")
		}
		if frames, _, _ := rec.snapshot(); len(frames) != 0 {
			t.Errorf("CANCEL sent %d frames, want 0", len(frames))
		}
	})

	t.Run("unknown parent", func(t *testing.T) {
		_, _, done := srvDispatch(d, &pb.Call{Id: 9, ParentId: 404, Method: cancelMethod}, noopParentCallAccessor{})
		srvWait(t, done)
	})
}

// done must only fire once the response has been sent; HTTPServer relies on
// this to know when it may stop writing.
func TestSrvDoneAfterResponse(t *testing.T) {
	d := NewServiceDispatcher(zap.NewNop())
	d.RegisterMethod("srv.order.ok", func(ctx context.Context, req *pb.Error) (*pb.Error, error) {
		return &pb.Error{}, nil
	})
	d.RegisterMethod("srv.order.fail", func(ctx context.Context, req *pb.Error) (*pb.Error, error) {
		return nil, errors.New("boom")
	})
	d.RegisterMethod("srv.order.panic", func(ctx context.Context, req *pb.Error) (*pb.Error, error) {
		panic("boom")
	})

	cases := []struct {
		method string
		kind   pb.Call_Kind
	}{
		{"srv.order.ok", pb.Call_CALL_KIND_DEFAULT},
		{"srv.order.fail", pb.Call_CALL_KIND_ERROR},
		{"srv.order.panic", pb.Call_CALL_KIND_ERROR},
		{"srv.order.missing", pb.Call_CALL_KIND_ERROR},
	}
	for _, c := range cases {
		t.Run(c.method, func(t *testing.T) {
			_, rec, done := srvDispatch(d, &pb.Call{Id: 1, Method: c.method}, noopParentCallAccessor{})
			if !srvWait(t, done) {
				return
			}
			frames, framesAtEnd, afterDone := rec.snapshot()
			if framesAtEnd != 1 || afterDone != 0 {
				t.Errorf("%d frames sent before done, %d after; want 1 before, 0 after", framesAtEnd, afterDone)
			}
			if len(frames) > 0 && (frames[0].Kind != c.kind || frames[0].ParentId != 1) {
				t.Errorf("got kind=%v parent=%d, want kind=%v parent=1", frames[0].Kind, frames[0].ParentId, c.kind)
			}
		})
	}
}

func TestSrvErrorMetrics(t *testing.T) {
	d := NewServiceDispatcher(zap.NewNop())
	d.RegisterMethod("srv.metrics.ok", func(ctx context.Context, req *pb.Error) (*pb.Error, error) {
		return &pb.Error{}, nil
	})
	d.RegisterMethod("srv.metrics.fail", func(ctx context.Context, req *pb.Error) (*pb.Error, error) {
		return nil, errors.New("boom")
	})
	d.RegisterMethod("srv.metrics.panic", func(ctx context.Context, req *pb.Error) (*pb.Error, error) {
		panic("boom")
	})
	d.RegisterMethod("srv.metrics.nilstream", func(ctx context.Context, req *pb.Error) (<-chan *pb.Error, error) {
		return nil, nil
	})

	cases := []struct {
		name    string
		method  string
		arg     []byte
		wantErr float64
	}{
		{"ok", "srv.metrics.ok", nil, 0},
		{"handler error", "srv.metrics.fail", nil, 1},
		{"panic", "srv.metrics.panic", nil, 1},
		{"nil stream", "srv.metrics.nilstream", nil, 1},
		{"bad argument", "srv.metrics.ok", []byte{0x0a, 0x05}, 1}, // truncated field
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			reqs := serverRequestCount.WithLabelValues(c.method)
			errs := serverErrorCount.WithLabelValues(c.method)
			r0, e0 := srvCounter(reqs), srvCounter(errs)

			call, _, done := srvDispatch(d, &pb.Call{Id: 1, Method: c.method, Argument: c.arg}, noopParentCallAccessor{})
			defer call.Cancel()
			if !srvWait(t, done) {
				return
			}

			if dr, de := srvCounter(reqs)-r0, srvCounter(errs)-e0; dr != 1 || de != c.wantErr {
				t.Errorf("request_count +%v error_count +%v, want +1 +%v", dr, de, c.wantErr)
			}
		})
	}
}

func TestSrvNilStream(t *testing.T) {
	d := NewServiceDispatcher(zap.NewNop())
	d.RegisterMethod("srv.nilstream", func(ctx context.Context, req *pb.Error) (<-chan *pb.Error, error) {
		return nil, nil
	})

	call, rec, done := srvDispatch(d, &pb.Call{Id: 1, Method: "srv.nilstream", Argument: srvMarshal(t, &pb.Error{})}, noopParentCallAccessor{})
	defer call.Cancel() // unblock the handler goroutine if the test fails
	if !srvWait(t, done) {
		return
	}

	frames, _, _ := rec.snapshot()
	if len(frames) != 1 || frames[0].Kind != pb.Call_CALL_KIND_ERROR {
		t.Fatalf("got frames %v, want one ERROR frame", frames)
	}
	res := &pb.Error{}
	if err := proto.Unmarshal(frames[0].Argument, res); err != nil || res.Message != errNilStream.Error() {
		t.Errorf("got error %q (%v), want %q", res.Message, err, errNilStream)
	}
}
