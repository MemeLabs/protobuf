package rpc

import (
	"context"
	"io"
	"sync"

	"go.uber.org/zap"
)

// RWFDialer dials a Transport like RWDialer, with its default limits, that
// flushes ReadWriteFlusher after each frame.
//
// As with RWDialer, the transport owns ReadWriteFlusher: when the transport
// stops (its dial context is done, e.g. Client.Close or cancelling the
// context passed to Server.Listen, or reading fails) it closes
// ReadWriteFlusher if it also implements io.Closer.
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

// Close closes the wrapped ReadWriteFlusher if it is an io.Closer; embedding
// ReadWriteFlusher doesn't promote Close.
func (r *rwfWriteFlusher) Close() error {
	if c, ok := r.ReadWriteFlusher.(io.Closer); ok {
		return c.Close()
	}
	return nil
}

// ReadWriteFlusher ...
type ReadWriteFlusher interface {
	io.ReadWriter
	Flush() error
}
