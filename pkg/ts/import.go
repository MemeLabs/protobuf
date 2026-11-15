package ts

import (
	"fmt"
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

// ImportSpec is one declaration a module imports, under a local alias.
type ImportSpec struct {
	Name     string
	Alias    string
	TypeOnly bool
}

// ImportLines returns the lines of a declaration importing specs from path.
// If every spec is type-only it's an `import type`, so verbatimModuleSyntax
// leaves no bare side-effect import behind.
func ImportLines(specs []ImportSpec, path string) []string {
	allTypes := true
	for _, s := range specs {
		allTypes = allTypes && s.TypeOnly
	}

	lines := []string{"import {"}
	if allTypes {
		lines[0] = "import type {"
	}
	for _, s := range specs {
		modifier := ""
		if s.TypeOnly && !allTypes {
			modifier = "type "
		}
		lines = append(lines, fmt.Sprintf("%s%s as %s,", modifier, s.Name, s.Alias))
	}
	return append(lines, fmt.Sprintf(`} from "%s";`, path))
}
