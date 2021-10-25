package rpc

import (
	"context"
	"io"
	"sync"

	"go.uber.org/zap"
)

// RWFDialer ...
type RWFDialer struct {
	Logger           *zap.Logger
	ReadWriteFlusher ReadWriteFlusher
}

// Dial ...
func (d *RWFDialer) Dial(ctx context.Context, dispatcher Dispatcher) (Transport, error) {
	rwd := RWDialer{
		Logger:     d.Logger,
		ReadWriter: &rwfWriteFlusher{ReadWriteFlusher: d.ReadWriteFlusher},
	}
	return rwd.Dial(ctx, dispatcher)
}

type rwfWriteFlusher struct {
	ReadWriteFlusher
	mu sync.Mutex
}

func (r *rwfWriteFlusher) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	n, err := r.ReadWriteFlusher.Write(p)
	if err != nil {
		return n, err
	}
	return n, r.ReadWriteFlusher.Flush()
}

// ReadWriteFlusher ...
type ReadWriteFlusher interface {
	io.ReadWriter
	Flush() error
}
