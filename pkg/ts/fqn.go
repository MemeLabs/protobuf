package ts

import (
	"fmt"
	"strings"

	pgs "github.com/lyft/protoc-gen-star"
)

func FQN(e pgs.Entity) string {
	return strings.ReplaceAll(strings.TrimPrefix(e.FullyQualifiedName(), "."), ".", "_")
}

func IfFQN(e pgs.Entity) string {
	fqn := FQN(e)
	if _, ok := e.(pgs.Enum); ok {
		return fqn
	}

	i := strings.LastIndex(fqn, "_") + 1
	return fmt.Sprintf("%sI%s", fqn[:i], fqn[i:])
}
