package rpc

import (
	"io"
	"slices"
	"sync/atomic"
)

const defaultMaxConcurrentCalls = 128

// concurrentCallLimit returns the limit a MaxConcurrentCalls of n sets:
// negative means unlimited.
func concurrentCallLimit(n int) int {
	if n == 0 {
		return defaultMaxConcurrentCalls
	}
	return n
}

// callSlots counts calls in service.
type callSlots struct {
	n atomic.Int64
}

// acquire takes a slot unless limit are taken; a negative limit means
// unlimited.
func (s *callSlots) acquire(limit int) bool {
	for {
		n := s.n.Load()
		if limit >= 0 && n >= int64(limit) {
			return false
		}
		if s.n.CompareAndSwap(n, n+1) {
			return true
		}
	}
}

// releaser returns a func that gives back an acquired slot the first time
// it is called.
func (s *callSlots) releaser() func() {
	var released atomic.Bool
	return func() {
		if released.CompareAndSwap(false, true) {
			s.n.Add(-1)
		}
	}
}

func noopRelease() {}

// frameChunk is the first amount by which readFrame grows a buffer.
const frameChunk = 64 << 10

// readFrame reads an l-byte frame from r into b, reusing b's capacity.
// Beyond that it allocates as the frame's bytes arrive, at most
// max(frameChunk, the bytes read so far) ahead of them.
func readFrame(r io.Reader, b []byte, l int) ([]byte, error) {
	if l <= cap(b) {
		b = b[:l]
		_, err := io.ReadFull(r, b)
		return b, err
	}

	b = b[:0]
	for len(b) < l {
		n := min(l-len(b), max(len(b), frameChunk))
		b = slices.Grow(b, n)
		m, err := io.ReadFull(r, b[len(b):len(b)+n])
		b = b[:len(b)+m]
		if err != nil {
			return b, err
		}
	}
	return b, nil
}
