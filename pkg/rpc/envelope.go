package rpc

import (
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
)

// Limits on the headers of a received frame. A header entry's size is the
// length of its encoded key and value, excluding the entry's own tag and
// length prefix. Entries are counted as they appear on the wire, duplicate
// keys included. A frame over either limit is rejected with
// ErrTooManyHeaders.
const (
	MaxHeaders     = 64
	MaxHeaderBytes = 64 << 10
)

// envelopeUnmarshal decodes pb.Call and pb.Error, which nest only map
// entries.
var envelopeUnmarshal = proto.UnmarshalOptions{RecursionLimit: 2, DiscardUnknown: true}

// envelope is what dispatch needs from a frame before decoding it.
type envelope struct {
	id          uint64
	parentID    uint64
	method      []byte // aliases the frame
	headers     int
	headerBytes int
}

func (e *envelope) overHeaderLimit() bool {
	return e.headers > MaxHeaders || e.headerBytes > MaxHeaderBytes
}

// scanEnvelope reads the top-level fields of the encoded pb.Call b without
// allocating. It fails only where proto.Unmarshal into a pb.Call fails, and
// where proto.Unmarshal succeeds the fields match its result.
func scanEnvelope(b []byte) (envelope, error) {
	var e envelope
	for len(b) > 0 {
		num, typ, n := protowire.ConsumeTag(b)
		if n < 0 {
			return e, protowire.ParseError(n)
		}
		if num > protowire.MaxValidNumber {
			return e, errInvalidFieldNumber
		}
		b = b[n:]

		switch {
		case num == 1 && typ == protowire.VarintType:
			e.id, n = protowire.ConsumeVarint(b)
		case num == 2 && typ == protowire.VarintType:
			e.parentID, n = protowire.ConsumeVarint(b)
		case num == 3 && typ == protowire.BytesType:
			e.method, n = protowire.ConsumeBytes(b)
		case num == 6 && typ == protowire.BytesType:
			var v []byte
			v, n = protowire.ConsumeBytes(b)
			e.headers++
			e.headerBytes += len(v)
		default:
			n = protowire.ConsumeFieldValue(num, typ, b)
		}
		if n < 0 {
			return e, protowire.ParseError(n)
		}
		b = b[n:]
	}
	return e, nil
}
