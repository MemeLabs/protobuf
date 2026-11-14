package ts

import (
	pgs "github.com/lyft/protoc-gen-star/v2"
)

// Context ...
type Context struct {
	pgs.BuildContext
}

// RuntimePath ...
func (c Context) RuntimePath() string {
	return c.Parameters().StrDefault("runtime", "@memelabs/protobuf")
}
