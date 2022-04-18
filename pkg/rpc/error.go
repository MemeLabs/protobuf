package rpc

import "errors"

type ErrorCoder interface {
	error
	ErrorCode() int32
}

func ErrorCode(err error) int32 {
	for err != nil {
		if ec, ok := err.(ErrorCoder); ok {
			return ec.ErrorCode()
		}
		err = errors.Unwrap(err)
	}
	return 0
}

type wrappedError struct {
	err  error
	code int32
}

func (w wrappedError) Unwrap() error {
	return w.err
}

func (w wrappedError) Error() string {
	return w.err.Error()
}

func (w wrappedError) ErrorCode() int32 {
	return w.code
}

func WrapError[T ~int32](err error, code T) error {
	return wrappedError{err, int32(code)}
}
