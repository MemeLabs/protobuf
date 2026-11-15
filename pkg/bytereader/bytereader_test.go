package bytereader

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"testing"
	"testing/iotest"
)

// A Read that returns the last byte together with io.EOF used to lose it.
func TestReadByteKeepsByteReadWithError(t *testing.T) {
	r := New(iotest.DataErrReader(bytes.NewReader([]byte{0x05})))
	v, err := binary.ReadUvarint(r)
	if err != nil || v != 5 {
		t.Fatalf("ReadUvarint = %d, %v; want 5, nil", v, err)
	}
	if _, err := r.ReadByte(); err != io.EOF {
		t.Fatalf("ReadByte after the last byte returned %v, want io.EOF", err)
	}
}

func TestReadByteDefersNonEOFError(t *testing.T) {
	errBoom := errors.New("boom")
	r := New(&scriptedReader{steps: []step{{b: 0x2a, n: 1, err: errBoom}}})
	if b, err := r.ReadByte(); b != 0x2a || err != nil {
		t.Fatalf("ReadByte = %#x, %v; want 0x2a, nil", b, err)
	}
	if _, err := r.ReadByte(); err != errBoom {
		t.Fatalf("second ReadByte returned %v, want the deferred error", err)
	}
}

// A Read that returns neither data nor an error used to be taken as a zero
// byte.
func TestReadByteRetriesEmptyRead(t *testing.T) {
	r := New(&scriptedReader{steps: []step{{}, {}, {}, {b: 0x2a, n: 1}}})
	if b, err := r.ReadByte(); b != 0x2a || err != nil {
		t.Fatalf("ReadByte = %#x, %v; want 0x2a, nil", b, err)
	}
}

func TestReadByteNoProgress(t *testing.T) {
	r := New(&scriptedReader{})
	if _, err := r.ReadByte(); err != io.ErrNoProgress {
		t.Fatalf("ReadByte returned %v, want io.ErrNoProgress", err)
	}
}

func TestReadByteSequence(t *testing.T) {
	r := New(iotest.OneByteReader(bytes.NewReader([]byte{1, 2, 3})))
	for _, want := range []byte{1, 2, 3} {
		if b, err := r.ReadByte(); b != want || err != nil {
			t.Fatalf("ReadByte = %d, %v; want %d, nil", b, err, want)
		}
	}
	if _, err := r.ReadByte(); err != io.EOF {
		t.Fatalf("ReadByte at the end returned %v, want io.EOF", err)
	}
}

type step struct {
	b   byte
	n   int
	err error
}

// scriptedReader plays back steps, then returns (0, nil) forever.
type scriptedReader struct {
	steps []step
}

func (r *scriptedReader) Read(p []byte) (int, error) {
	if len(r.steps) == 0 {
		return 0, nil
	}
	s := r.steps[0]
	r.steps = r.steps[1:]
	if s.n > 0 {
		p[0] = s.b
	}
	return s.n, s.err
}
