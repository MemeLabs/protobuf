package rpc

func (x *Error) Error() string {
	return x.Message
}

func (x *Error) ErrorCode() int32 {
	return x.Code
}
