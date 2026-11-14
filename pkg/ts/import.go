package ts

import (
	"strings"

	pgs "github.com/lyft/protoc-gen-star/v2"
)

// ImportPath returns the relative path the TS module generated from `from`
// imports the one generated from `to` by. Modules are written to their
// package's directory (a.b → a/b/) under their proto's base name.
func ImportPath(from, to pgs.File) string {
	iparts := strings.Split(strings.TrimPrefix(to.FullyQualifiedName(), "."), ".")
	iparts = append(iparts, to.InputPath().BaseName())
	fparts := strings.Split(strings.TrimPrefix(from.FullyQualifiedName(), "."), ".")

	l := min(len(iparts), len(fparts))
	common := 0
	for common < l && iparts[common] == fparts[common] {
		common++
	}

	prefix := "./"
	if unique := len(fparts) - common; unique != 0 {
		prefix = strings.Repeat("../", unique)
	}
	return prefix + strings.Join(iparts[common:], "/")
}
