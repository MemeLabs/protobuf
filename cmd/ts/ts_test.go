package main

import (
	"bytes"
	"reflect"
	"slices"
	"sort"
	"strings"
	"testing"

	pgs "github.com/lyft/protoc-gen-star/v2"
	"google.golang.org/protobuf/proto"
	descriptor "google.golang.org/protobuf/types/descriptorpb"
	plugin "google.golang.org/protobuf/types/pluginpb"
)

// protoFile is name, in package pkg, declaring one message, msg, whose fields
// are of the message types fields (fully qualified), imported from deps.
func protoFile(name, pkg, msg string, deps []string, fields ...string) *descriptor.FileDescriptorProto {
	m := &descriptor.DescriptorProto{Name: proto.String(msg)}
	for i, typ := range fields {
		m.Field = append(m.Field, &descriptor.FieldDescriptorProto{
			Name:     proto.String(strings.ToLower(typ[strings.LastIndex(typ, ".")+1:])),
			Number:   proto.Int32(int32(i + 1)),
			Label:    descriptor.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
			Type:     descriptor.FieldDescriptorProto_TYPE_MESSAGE.Enum(),
			TypeName: proto.String(typ),
		})
	}
	return &descriptor.FileDescriptorProto{
		Name:        proto.String(name),
		Package:     proto.String(pkg),
		Syntax:      proto.String("proto3"),
		Dependency:  deps,
		Options:     &descriptor.FileOptions{GoPackage: proto.String("example.com/" + pkg + ";" + pkg)},
		MessageType: []*descriptor.DescriptorProto{m},
	}
}

// TestRender runs a request through the plugin as main does: each module is
// named <proto base name>.pb.ts in its package's directory, and imports the
// modules it depends on by their .pb names.
func TestRender(t *testing.T) {
	req := &plugin.CodeGeneratorRequest{
		FileToGenerate: []string{"y/b.proto", "x/c.proto", "x/a.proto"},
		ProtoFile: []*descriptor.FileDescriptorProto{
			protoFile("y/b.proto", "y", "B", nil),
			protoFile("x/c.proto", "x", "C", nil),
			protoFile("x/a.proto", "x", "A", []string{"y/b.proto", "x/c.proto"}, ".y.B", ".x.C"),
		},
	}
	in, err := proto.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	pgs.Init(
		pgs.ProtocInput(bytes.NewReader(in)),
		pgs.ProtocOutput(&out),
	).RegisterModule(
		TS(),
	).Render()

	var res plugin.CodeGeneratorResponse
	if err := proto.Unmarshal(out.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.GetError() != "" {
		t.Fatalf("error = %q", res.GetError())
	}

	content := map[string]string{}
	var files []string
	for _, f := range res.GetFile() {
		files = append(files, f.GetName())
		content[f.GetName()] = f.GetContent()
	}
	sort.Strings(files)
	if want := []string{"x/a.pb.ts", "x/c.pb.ts", "y/b.pb.ts"}; !reflect.DeepEqual(files, want) {
		t.Fatalf("files = %q, want %q", files, want)
	}

	lines := strings.Split(content["x/a.pb.ts"], "\n")
	for _, m := range []string{"../y/b.pb", "./c.pb", "@memelabs/protobuf/lib/pb/reader", "@memelabs/protobuf/lib/pb/writer"} {
		if !slices.ContainsFunc(lines, func(l string) bool { return strings.HasSuffix(l, `from "`+m+`";`) }) {
			t.Errorf("x/a.pb.ts doesn't import %q:\n%s", m, content["x/a.pb.ts"])
		}
	}
}
