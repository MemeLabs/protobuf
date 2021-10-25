package rpc

import (
	"context"
	"fmt"
	"reflect"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
)

var (
	serverRequestCount = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "strims_rpc_server_request_count",
		Help: "The total number of rpc server requests",
	}, []string{"method"})
	serverErrorCount = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "strims_rpc_server_error_count",
		Help: "The total number of rpc server errors",
	}, []string{"method"})
	serverRequestDurationMs = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name: "strims_rpc_server_request_duration_ms",
		Help: "The request duration for rpc server requests",
	}, []string{"method"})
)

// NewServer ...
func NewServer(logger *zap.Logger, dialer Dialer) *Server {
	return &Server{
		ServiceDispatcher: NewServiceDispatcher(logger),
		dialer:            dialer,
	}
}

// Server ...
type Server struct {
	*ServiceDispatcher
	dialer Dialer
}

// Listen ...
func (s *Server) Listen(ctx context.Context) error {
	transport, err := s.dialer.Dial(ctx, s.ServiceDispatcher)
	if err != nil {
		return err
	}

	return transport.Listen()
}

// NewServiceDispatcher ...
func NewServiceDispatcher(logger *zap.Logger) *ServiceDispatcher {
	return &ServiceDispatcher{
		logger:  logger,
		methods: map[string]serviceMethod{},
	}
}

// ServiceDispatcher ...
type ServiceDispatcher struct {
	logger  *zap.Logger
	methods map[string]serviceMethod
}

// RegisterMethod ...
func (h *ServiceDispatcher) RegisterMethod(name string, method interface{}) {
	h.methods[name] = serviceMethod{
		fn:                reflect.ValueOf(method),
		arg:               reflect.TypeOf(method).In(1).Elem(),
		requestCount:      serverRequestCount.WithLabelValues(name),
		requestDurationMs: serverRequestDurationMs.WithLabelValues(name),
		errorCount:        serverRequestCount.WithLabelValues(name),
	}
}

// Dispatch ...
func (h *ServiceDispatcher) Dispatch(call *CallIn, done func()) {
	switch call.Method() {
	case cancelMethod:
		h.cancel(call)
	default:
		go h.call(call, done)
	}
}

func (h *ServiceDispatcher) cancel(call *CallIn) {
	if parent := call.ParentCallIn(); parent != nil {
		parent.Cancel()
	}
}

func (h *ServiceDispatcher) call(call *CallIn, done func()) {
	method, ok := h.methods[call.Method()]
	if !ok {
		call.returnError(fmt.Errorf("method not found: %s", call.Method()))
		return
	}

	method.requestCount.Inc()
	defer func(start time.Time) {
		done()

		if err := recoverError(recover()); err != nil {
			method.errorCount.Inc()
			h.logger.Error("call handler panicked", zap.Error(err), zap.Stack("stack"))
			call.returnError(err)
		}

		duration := time.Since(start)
		method.requestDurationMs.Observe(float64(duration / time.Millisecond))
		h.logger.Debug(
			"rpc received",
			zap.String("method", call.Method()),
			zap.Stringer("responseType", call.ResponseType()),
			zap.Duration("duration", duration),
		)
	}(time.Now())

	arg := reflect.New(method.arg)
	if err := call.Argument(arg.Interface().(proto.Message)); err != nil {
		serverErrorCount.WithLabelValues(call.Method()).Inc()
		call.returnError(err)
		return
	}

	rs := method.fn.Call([]reflect.Value{reflect.ValueOf(call.Context()), arg})
	if len(rs) == 0 {
		call.returnUndefined()
	} else if err, ok := rs[len(rs)-1].Interface().(error); ok && err != nil {
		method.errorCount.Inc()
		call.returnError(err)
	} else if r := rs[0]; r.Kind() == reflect.Chan {
		call.returnStream(r.Interface())
	} else if r, ok := rs[0].Interface().(proto.Message); ok {
		call.returnValue(r)
	} else {
		call.returnError(fmt.Errorf("unexpected response type %T", rs[0].Interface()))
	}
}

type serviceMethod struct {
	fn                reflect.Value
	arg               reflect.Type
	requestCount      prometheus.Counter
	requestDurationMs prometheus.Observer
	errorCount        prometheus.Counter
}
