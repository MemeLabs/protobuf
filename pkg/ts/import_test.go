package ts

import (
	"testing"

	pgs "github.com/lyft/protoc-gen-star/v2"
	"google.golang.org/protobuf/proto"
	descriptor "google.golang.org/protobuf/types/descriptorpb"
	plugin "google.golang.org/protobuf/types/pluginpb"
)

func TestImportPath(t *testing.T) {
	files := map[string]string{ // proto file: package
		"a/x.proto":                           "a",
		"a/y.proto":                           "a",
		"a/b.proto":                           "a",
		"a/b/z.proto":                         "a.b",
		"c/w.proto":                           "c",
		"google/protobuf/timestamp.proto":     "google.protobuf",
		"strims/examples/ticker/ticker.proto": "strims.examples.ticker",
	}
	req := &plugin.CodeGeneratorRequest{}
	for name, pkg := range files {
		req.FileToGenerate = append(req.FileToGenerate, name)
		req.ProtoFile = append(req.ProtoFile, &descriptor.FileDescriptorProto{
			Name:    proto.String(name),
			Package: proto.String(pkg),
			Syntax:  proto.String("proto3"),
			Options: &descriptor.FileOptions{GoPackage: proto.String("example.com/" + pkg)},
		})
	}
	ast := pgs.ProcessCodeGeneratorRequest(pgs.InitMockDebugger(), req)
	file := func(name string) pgs.File {
		f, ok := ast.Targets()[name]
		if !ok {
			t.Fatalf("no file %s", name)
		}
		return f
	}

	cases := []struct{ from, to, want string }{
		{"a/x.proto", "a/y.proto", "./y.pb"},
		{"a/x.proto", "a/b/z.proto", "./b/z.pb"},
		{"a/b/z.proto", "a/x.proto", "../x.pb"},
		{"a/x.proto", "c/w.proto", "../c/w.pb"},
		{"strims/examples/ticker/ticker.proto", "google/protobuf/timestamp.proto", "../../../google/protobuf/timestamp.pb"},
		// a/b.pb.ts sits beside the a/b/ directory a/b/z.pb.ts is in
		{"a/b/z.proto", "a/b.proto", "../b.pb"},
	}
	for _, c := range cases {
		if got := ImportPath(file(c.from), file(c.to)); got != c.want {
			t.Errorf("ImportPath(%s, %s) = %q, want %q", c.from, c.to, got, c.want)
		}
	}
}
