package rpc

import "google.golang.org/protobuf/proto"

// UnmarshalFunc decodes b into m. It must be safe for concurrent use.
type UnmarshalFunc func(b []byte, m proto.Message) error

var defaultUnmarshal UnmarshalFunc = proto.UnmarshalOptions{RecursionLimit: 100}.Unmarshal

func unmarshalOrDefault(fn UnmarshalFunc) UnmarshalFunc {
	if fn == nil {
		return defaultUnmarshal
	}
	return fn
}

// Option configures NewClient, NewServer, NewServiceDispatcher and
// NewHTTPServer.
type Option func(*options)

type options struct {
	unmarshal UnmarshalFunc
}

func newOptions(opts []Option) options {
	var o options
	for _, opt := range opts {
		if opt != nil {
			opt(&o)
		}
	}
	o.unmarshal = unmarshalOrDefault(o.unmarshal)
	return o
}

// WithUnmarshal sets the function that decodes the messages a peer sends:
// request arguments on a server, responses on a client. nil means the
// default, proto.UnmarshalOptions{RecursionLimit: 100}.Unmarshal.
func WithUnmarshal(fn UnmarshalFunc) Option {
	return func(o *options) {
		o.unmarshal = fn
	}
}
