package bytereader

import "io"

// maxConsecutiveEmptyReads bounds retries of reads that return no data and no
// error.
const maxConsecutiveEmptyReads = 100

// New returns an unbuffered io.ByteReader that reads one byte per Read, so r
// can also be read directly between calls. Empty reads are retried up to
// maxConsecutiveEmptyReads times, then ReadByte fails with io.ErrNoProgress.
// An error returned along with a byte is returned by the next ReadByte.
func New(r io.Reader) io.ByteReader {
	return &reader{r: r}
}

type reader struct {
	r   io.Reader
	b   [1]byte
	err error
}

func (r *reader) ReadByte() (byte, error) {
	if err := r.err; err != nil {
		r.err = nil
		return 0, err
	}

	for range maxConsecutiveEmptyReads {
		n, err := r.r.Read(r.b[:])
		if n > 0 {
			r.err = err
			return r.b[0], nil
		}
		if err != nil {
			return 0, err
		}
	}
	return 0, io.ErrNoProgress
}
