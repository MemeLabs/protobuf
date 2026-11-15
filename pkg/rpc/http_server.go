package rpc

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"math"
	"net/http"
	"strconv"
	"sync"

	pb "github.com/MemeLabs/protobuf/pkg/apis/rpc"
	"github.com/MemeLabs/protobuf/pkg/bytereader"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
)

// NewHTTPServer returns an HTTPServer with no methods.
func NewHTTPServer(logger *zap.Logger, opts ...Option) *HTTPServer {
	return &HTTPServer{
		ServiceDispatcher: NewServiceDispatcher(logger, opts...),
	}
}

// HTTPServer ...
type HTTPServer struct {
	*ServiceDispatcher

	// MaxMessageBytes caps a request's message size; larger requests get a
	// 413. 0 means the default, 512 KiB; negative means unlimited. Set it
	// before serving.
	MaxMessageBytes int

	// MaxConcurrentCalls limits the requests in service at once, across all
	// clients; a request beyond it gets an ERROR response with
	// ErrTooManyCalls. CANCEL requests are not limited. 0 means the default,
	// 128; negative means unlimited. Set it before serving.
	MaxConcurrentCalls int

	inService callSlots
}

func (s *HTTPServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	maxMessageBytes := s.MaxMessageBytes
	if maxMessageBytes == 0 {
		maxMessageBytes = defaultMaxMessageBytes
	}

	l, err := binary.ReadUvarint(bytereader.New(r.Body))
	if err != nil {
		httpServeError(http.StatusBadRequest, err, w)
		return
	}
	if l > math.MaxInt || (maxMessageBytes >= 0 && l > uint64(maxMessageBytes)) {
		httpServeError(http.StatusRequestEntityTooLarge, ErrMessageTooLarge, w)
		return
	}

	b, err := readFrame(r.Body, nil, int(l))
	if err != nil {
		httpServeError(http.StatusBadRequest, err, w)
		return
	}

	// Reading to EOF rejects trailing data and lets net/http detect a disconnect.
	if n, err := io.Copy(io.Discard, io.LimitReader(r.Body, 1)); err != nil {
		httpServeError(http.StatusBadRequest, err, w)
		return
	} else if n != 0 {
		httpServeError(http.StatusBadRequest, errHTTPTrailingData, w)
		return
	}

	env, err := scanEnvelope(b)
	if err != nil {
		httpServeError(http.StatusBadRequest, err, w)
		return
	}
	if env.overHeaderLimit() {
		httpServeError(http.StatusBadRequest, ErrTooManyHeaders, w)
		return
	}

	release := noopRelease
	if !env.isCancel() {
		if !s.inService.acquire(concurrentCallLimit(s.MaxConcurrentCalls)) {
			sendError(r.Context(), env.id, ErrTooManyCalls, func(_ context.Context, res *pb.Call) error {
				return httpServeProto(res, w)
			})
			return
		}
		release = s.inService.releaser()
	}

	req := &pb.Call{}
	if err := envelopeUnmarshal.Unmarshal(b, req); err != nil {
		release()
		httpServeError(http.StatusBadRequest, err, w)
		return
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// w must not be used after ServeHTTP returns: rw.close drops later writes.
	rw := &httpResponseWriter{w: w}
	defer rw.close()

	done := make(chan struct{})
	var doneOnce sync.Once
	call := NewCallIn(ctx, req, noopParentCallAccessor{}, rw.send)
	s.ServiceDispatcher.Dispatch(call, func() {
		doneOnce.Do(func() {
			release()
			close(done)
		})
	})

	select {
	case <-done:
	case <-r.Context().Done():
	}
}

var (
	errHTTPResponseClosed = errors.New("http response closed")
	errHTTPTrailingData   = errors.New("trailing data after message")
)

// httpResponseWriter serializes a call's writes to w and rejects them after
// close.
type httpResponseWriter struct {
	mu     sync.Mutex
	w      http.ResponseWriter
	closed bool
}

func (w *httpResponseWriter) send(_ context.Context, res *pb.Call) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return errHTTPResponseClosed
	}
	return httpServeProto(res, w.w)
}

func (w *httpResponseWriter) close() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.closed = true
}

func httpServeError(statusCode int, err error, w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "text/plain")
	w.Header().Set("Content-Length", strconv.Itoa(len(err.Error())))
	w.WriteHeader(statusCode)
	_, err = w.Write([]byte(err.Error()))
	return err
}

func httpServeProto(m proto.Message, w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/protobuf")

	b := bufPool.Get().([]byte)[:0]
	b, err := marshalAppendLengthDelimited(b, m)
	defer bufPool.Put(b)
	if err != nil {
		return err
	}

	if _, err := w.Write(b); err != nil {
		return err
	}

	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}

	return nil
}

type noopParentCallAccessor struct{}

func (a noopParentCallAccessor) ParentCallIn() *CallIn {
	return nil
}

func (a noopParentCallAccessor) ParentCallOut() *CallOut {
	return nil
}
