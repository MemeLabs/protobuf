package rpc

func (x *Error) Error() string {
	return x.Message
}

func (x *Error) ErrorCode() int32 {
	return x.Code
}

// Is reports whether target has an ErrorCode method that returns x's code.
// A code of 0 matches nothing.
func (x *Error) Is(target error) bool {
	if x == nil || x.Code == 0 {
		return false
	}
	c, ok := target.(interface{ ErrorCode() int32 })
	return ok && c.ErrorCode() == x.Code
}
