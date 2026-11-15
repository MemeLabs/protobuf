package main

import (
	"reflect"
	"testing"

	pgs "github.com/lyft/protoc-gen-star/v2"
	"google.golang.org/protobuf/proto"
	descriptor "google.golang.org/protobuf/types/descriptorpb"
	plugin "google.golang.org/protobuf/types/pluginpb"
)

func method(name string, clientStreaming, serverStreaming bool) *descriptor.MethodDescriptorProto {
	return &descriptor.MethodDescriptorProto{
		Name:            proto.String(name),
		InputType:       proto.String(".x.Req"),
		OutputType:      proto.String(".x.Res"),
		ClientStreaming: proto.Bool(clientStreaming),
		ServerStreaming: proto.Bool(serverStreaming),
	}
}

// request is the CodeGeneratorRequest protoc sends for x/svc.proto holding
// service S with methods.
func request(methods ...*descriptor.MethodDescriptorProto) *plugin.CodeGeneratorRequest {
	f := &descriptor.FileDescriptorProto{
		Name:    proto.String("x/svc.proto"),
		Package: proto.String("x"),
		Syntax:  proto.String("proto3"),
		Options: &descriptor.FileOptions{GoPackage: proto.String("example.com/x;x")},
		MessageType: []*descriptor.DescriptorProto{
			{Name: proto.String("Req")},
			{Name: proto.String("Res")},
		},
		Service: []*descriptor.ServiceDescriptorProto{
			{Name: proto.String("S"), Method: methods},
		},
	}
	return &plugin.CodeGeneratorRequest{
		FileToGenerate: []string{f.GetName()},
		ProtoFile:      []*descriptor.FileDescriptorProto{f},
	}
}

func TestExecuteRejectsClientStreaming(t *testing.T) {
	const unsupported = ": client-streaming methods are not supported (only unary and server-streaming)"

	cases := []struct {
		name      string
		methods   []*descriptor.MethodDescriptorProto
		wantErrs  []string
		wantFiles int
	}{
		{
			name:      "unary and server streaming",
			methods:   []*descriptor.MethodDescriptorProto{method("Unary", false, false), method("ServerStream", false, true)},
			wantFiles: 1,
		},
		{
			name:     "client streaming",
			methods:  []*descriptor.MethodDescriptorProto{method("Unary", false, false), method("ClientStream", true, false)},
			wantErrs: []string{"x/svc.proto: x.S.ClientStream" + unsupported},
		},
		{
			name:     "bidi streaming",
			methods:  []*descriptor.MethodDescriptorProto{method("Bidi", true, true)},
			wantErrs: []string{"x/svc.proto: x.S.Bidi" + unsupported},
		},
		{
			name:    "every offender",
			methods: []*descriptor.MethodDescriptorProto{method("ClientStream", true, false), method("ServerStream", false, true), method("Bidi", true, true)},
			wantErrs: []string{
				"x/svc.proto: x.S.ClientStream" + unsupported,
				"x/svc.proto: x.S.Bidi" + unsupported,
			},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			d := pgs.InitMockDebugger()
			ast := pgs.ProcessCodeGeneratorRequest(d, request(c.methods...))

			m := TSRPC()
			m.InitContext(pgs.Context(d, pgs.Parameters{}, "."))
			artifacts := m.Execute(ast.Targets(), ast.Packages())

			var errs []string
			var files int
			for _, a := range artifacts {
				switch a := a.(type) {
				case pgs.GeneratorError:
					errs = append(errs, a.Message)
				case pgs.GeneratorFile:
					files++
				default:
					t.Errorf("unexpected artifact %T", a)
				}
			}

			if d.Failed() || d.Exited() {
				t.Errorf("debugger failed or exited")
			}
			if !reflect.DeepEqual(errs, c.wantErrs) {
				t.Errorf("errors = %q, want %q", errs, c.wantErrs)
			}
			if files != c.wantFiles {
				t.Errorf("generated %d files, want %d", files, c.wantFiles)
			}
		})
	}
}
