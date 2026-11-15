package ts

import (
	"strings"

	pgs "github.com/lyft/protoc-gen-star/v2"
)

// FQN returns the package-qualified identifier for e: its fully qualified
// proto name with each `.` replaced by `_`. A generated module imports
// another's declarations under these names, so they can't collide with its
// own.
func FQN(e pgs.Entity) string {
	return strings.ReplaceAll(strings.TrimPrefix(e.FullyQualifiedName(), "."), ".", "_")
}

// IfFQN is FQN for a message's constructor argument type. An enum has none,
// so it's the enum's FQN.
func IfFQN(e pgs.Entity) string {
	fqn := FQN(e)
	if _, ok := e.(pgs.Enum); ok {
		return fqn
	}

	own := e.Name().String()
	return fqn[:len(fqn)-len(own)] + "I" + own
}

// LocalName returns the identifier e is declared as in its own module: the
// names from its file's package down to e, each in upper camel case, joined
// by `_`. A nested type is a top-level declaration like any other, so
// `Bar.Foo` is declared as `Bar_Foo`.
func LocalName(e pgs.Entity) string {
	return strings.Join(localNameParts(e), "_")
}

// IfLocalName is LocalName for a message's constructor argument type:
// `Bar.Foo`'s is `Bar_IFoo`. An enum has none, so it's the enum's LocalName.
func IfLocalName(e pgs.Entity) string {
	parts := localNameParts(e)
	if _, ok := e.(pgs.Enum); !ok {
		parts[len(parts)-1] = "I" + parts[len(parts)-1]
	}
	return strings.Join(parts, "_")
}

func localNameParts(e pgs.Entity) []string {
	rel := strings.TrimPrefix(strings.TrimPrefix(e.FullyQualifiedName(), e.File().FullyQualifiedName()), ".")
	parts := strings.Split(rel, ".")
	for i, p := range parts {
		parts[i] = pgs.Name(p).UpperCamelCase().String()
	}
	return parts
}
