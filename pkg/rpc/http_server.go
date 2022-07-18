package rpc

import (
	"context"
	"encoding/binary"
	"io"
	"net/http"
	"strconv"

	pb "github.com/MemeLabs/protobuf/pkg/apis/rpc"
	"github.com/MemeLabs/protobuf/pkg/bytereader"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
)

// NewHTTPServer ...
func NewHTTPServer(logger *zap.Logger) *HTTPServer {
	return &HTTPServer{
		ServiceDispatcher: NewServiceDispatcher(logger),
	}
}

// HTTPServer ...
type HTTPServer struct {
	*ServiceDispatcher
}

func (s *HTTPServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	l, err := binary.ReadUvarint(bytereader.New(r.Body))
	if err != nil {
		httpServeError(http.StatusBadRequest, err, w)
		return
	}

	b := make([]byte, l)
	if _, err := io.ReadAtLeast(r.Body, b, int(l)); err != nil {
		httpServeError(http.StatusBadRequest, err, w)
		return
	}

	req := &pb.Call{}
	if err := proto.Unmarshal(b, req); err != nil {
		httpServeError(http.StatusBadRequest, err, w)
		return
	}

	ctx, cancel := context.WithCancel(r.Context())
	send := func(_ context.Context, res *pb.Call) error {
		return httpServeProto(res, w)
	}
	call := NewCallIn(ctx, req, noopParentCallAccessor{}, send)

	s.ServiceDispatcher.Dispatch(call, cancel)
	<-ctx.Done()
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
