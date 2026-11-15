package main

import (
	"bytes"
	"reflect"
	"slices"
	"strings"
	"testing"

	pgs "github.com/lyft/protoc-gen-star/v2"
	"google.golang.org/protobuf/proto"
	descriptor "google.golang.org/protobuf/types/descriptorpb"
	plugin "google.golang.org/protobuf/types/pluginpb"
)

const unsupported = ": client-streaming and bidirectional methods are not supported (only unary and server-streaming)"

func method(name string, clientStreaming, serverStreaming bool) *descriptor.MethodDescriptorProto {
	return &descriptor.MethodDescriptorProto{
		Name:            proto.String(name),
		InputType:       proto.String(".x.Req"),
		OutputType:      proto.String(".x.Res"),
		ClientStreaming: proto.Bool(clientStreaming),
		ServerStreaming: proto.Bool(serverStreaming),
	}
}

var (
	unary        = method("Unary", false, false)
	serverStream = method("ServerStream", false, true)
	clientStream = method("ClientStream", true, false)
	bidi         = method("Bidi", true, true)
)

// protoFile is a file in package pkg (x if empty) holding service svc. It
// imports x/msg.proto, which declares Req and Res, and deps.
type protoFile struct {
	name, pkg, svc string
	methods        []*descriptor.MethodDescriptorProto
	deps           []string
}

func (f protoFile) descriptor() *descriptor.FileDescriptorProto {
	pkg := f.pkg
	if pkg == "" {
		pkg = "x"
	}
	return &descriptor.FileDescriptorProto{
		Name:       proto.String(f.name),
		Package:    proto.String(pkg),
		Syntax:     proto.String("proto3"),
		Dependency: append([]string{"x/msg.proto"}, f.deps...),
		Options:    &descriptor.FileOptions{GoPackage: proto.String("example.com/" + pkg + ";" + pkg)},
		Service:    []*descriptor.ServiceDescriptorProto{{Name: proto.String(f.svc), Method: f.methods}},
	}
}

// request is the CodeGeneratorRequest protoc sends to generate targets, with
// x/msg.proto and then files (in dependency order) as its proto files.
func request(targets []string, files ...protoFile) *plugin.CodeGeneratorRequest {
	req := &plugin.CodeGeneratorRequest{
		FileToGenerate: targets,
		ProtoFile: []*descriptor.FileDescriptorProto{{
			Name:    proto.String("x/msg.proto"),
			Package: proto.String("x"),
			Syntax:  proto.String("proto3"),
			Options: &descriptor.FileOptions{GoPackage: proto.String("example.com/x;x")},
			MessageType: []*descriptor.DescriptorProto{
				{Name: proto.String("Req")},
				{Name: proto.String("Res")},
			},
		}},
	}
	for _, f := range files {
		req.ProtoFile = append(req.ProtoFile, f.descriptor())
	}
	return req
}

func TestExecuteRejectsClientStreaming(t *testing.T) {
	cases := []struct {
		name      string
		req       *plugin.CodeGeneratorRequest
		wantErrs  []string
		wantFiles int
	}{
		{
			name:      "unary and server streaming",
			req:       request([]string{"x/a.proto"}, protoFile{name: "x/a.proto", svc: "A", methods: []*descriptor.MethodDescriptorProto{unary, serverStream}}),
			wantFiles: 1,
		},
		{
			name:     "client streaming",
			req:      request([]string{"x/a.proto"}, protoFile{name: "x/a.proto", svc: "A", methods: []*descriptor.MethodDescriptorProto{unary, clientStream}}),
			wantErrs: []string{"x/a.proto: x.A.ClientStream" + unsupported},
		},
		{
			name:     "bidi streaming",
			req:      request([]string{"x/a.proto"}, protoFile{name: "x/a.proto", svc: "A", methods: []*descriptor.MethodDescriptorProto{bidi}}),
			wantErrs: []string{"x/a.proto: x.A.Bidi" + unsupported},
		},
		{
			name: "every offender in declaration order",
			req:  request([]string{"x/a.proto"}, protoFile{name: "x/a.proto", svc: "A", methods: []*descriptor.MethodDescriptorProto{clientStream, serverStream, bidi}}),
			wantErrs: []string{
				"x/a.proto: x.A.ClientStream" + unsupported,
				"x/a.proto: x.A.Bidi" + unsupported,
			},
		},
		{
			name: "files with offenders sorted by path",
			req: request(
				[]string{"y/c.proto", "x/b.proto", "x/a.proto"},
				protoFile{name: "y/c.proto", pkg: "y", svc: "C", methods: []*descriptor.MethodDescriptorProto{clientStream}},
				protoFile{name: "x/b.proto", svc: "B", methods: []*descriptor.MethodDescriptorProto{bidi}},
				protoFile{name: "x/a.proto", svc: "A", methods: []*descriptor.MethodDescriptorProto{clientStream, bidi}},
			),
			wantErrs: []string{
				"x/a.proto: x.A.ClientStream" + unsupported,
				"x/a.proto: x.A.Bidi" + unsupported,
				"x/b.proto: x.B.Bidi" + unsupported,
				"y/c.proto: y.C.ClientStream" + unsupported,
			},
		},
		{
			name: "valid target and failing target",
			req: request(
				[]string{"x/a.proto", "x/b.proto"},
				protoFile{name: "x/a.proto", svc: "A", methods: []*descriptor.MethodDescriptorProto{unary, serverStream}},
				protoFile{name: "x/b.proto", svc: "B", methods: []*descriptor.MethodDescriptorProto{clientStream}},
			),
			wantErrs: []string{"x/b.proto: x.B.ClientStream" + unsupported},
		},
		{
			// tsrpc generates for every file in its targets' packages...
			name: "imported file",
			req: request(
				[]string{"x/a.proto"},
				protoFile{name: "x/b.proto", svc: "B", methods: []*descriptor.MethodDescriptorProto{serverStream}},
				protoFile{name: "x/a.proto", svc: "A", methods: []*descriptor.MethodDescriptorProto{unary}, deps: []string{"x/b.proto"}},
			),
			wantFiles: 2,
		},
		{
			// ...so it checks them too, and says which ones weren't targets
			name: "imported offender",
			req: request(
				[]string{"x/a.proto"},
				protoFile{name: "x/b.proto", svc: "B", methods: []*descriptor.MethodDescriptorProto{clientStream}},
				protoFile{name: "x/a.proto", svc: "A", methods: []*descriptor.MethodDescriptorProto{unary}, deps: []string{"x/b.proto"}},
			),
			wantErrs: []string{"x/b.proto (imported): x.B.ClientStream" + unsupported},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			// repeated, as Execute gets its files in maps
			for range 20 {
				d := pgs.InitMockDebugger()
				ast := pgs.ProcessCodeGeneratorRequest(d, c.req)

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
						t.Fatalf("unexpected artifact %T", a)
					}
				}

				if d.Failed() || d.Exited() {
					t.Fatalf("debugger failed or exited")
				}
				if !reflect.DeepEqual(errs, c.wantErrs) {
					t.Fatalf("errors = %q, want %q", errs, c.wantErrs)
				}
				if files != c.wantFiles {
					t.Fatalf("generated %d files, want %d", files, c.wantFiles)
				}
			}
		})
	}
}

// TestRender runs requests through the plugin as main does, and decodes the
// response protoc would get.
func TestRender(t *testing.T) {
	cases := []struct {
		name      string
		req       *plugin.CodeGeneratorRequest
		param     string
		wantErr   string
		wantFiles []string
		// modules the generated file must import, each with a whole line
		// `} from "<module>";`
		wantImports []string
	}{
		{
			name:      "valid",
			req:       request([]string{"x/a.proto"}, protoFile{name: "x/a.proto", svc: "A", methods: []*descriptor.MethodDescriptorProto{unary, serverStream}}),
			wantFiles: []string{"x/a_rpc.pb.ts"},
			wantImports: []string{
				"@memelabs/protobuf/lib/apis/strims/rpc/rpc.pb",
				"./msg.pb",
			},
		},
		{
			name:      "runtime=self",
			req:       request([]string{"x/a.proto"}, protoFile{name: "x/a.proto", svc: "A", methods: []*descriptor.MethodDescriptorProto{unary}}),
			param:     "runtime=self",
			wantFiles: []string{"x/a_rpc.pb.ts"},
			// from src/apis/x/, with the runtime's modules in src/
			wantImports: []string{
				"../../apis/strims/rpc/rpc.pb",
				"../../rpc/host",
				"./msg.pb",
			},
		},
		{
			name: "offenders",
			req: request(
				[]string{"x/b.proto", "x/a.proto"},
				protoFile{name: "x/b.proto", svc: "B", methods: []*descriptor.MethodDescriptorProto{clientStream}},
				protoFile{name: "x/a.proto", svc: "A", methods: []*descriptor.MethodDescriptorProto{unary, bidi}},
			),
			wantErr: "x/a.proto: x.A.Bidi" + unsupported + "; x/b.proto: x.B.ClientStream" + unsupported,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if c.param != "" {
				c.req.Parameter = proto.String(c.param)
			}
			in, err := proto.Marshal(c.req)
			if err != nil {
				t.Fatal(err)
			}
			var out bytes.Buffer
			pgs.Init(
				pgs.ProtocInput(bytes.NewReader(in)),
				pgs.ProtocOutput(&out),
			).RegisterModule(
				TSRPC(),
			).Render()

			var res plugin.CodeGeneratorResponse
			if err := proto.Unmarshal(out.Bytes(), &res); err != nil {
				t.Fatal(err)
			}
			if res.GetError() != c.wantErr {
				t.Errorf("error = %q, want %q", res.GetError(), c.wantErr)
			}
			var files []string
			for _, f := range res.GetFile() {
				files = append(files, f.GetName())
				lines := strings.Split(f.GetContent(), "\n")
				for _, m := range c.wantImports {
					if !slices.ContainsFunc(lines, func(l string) bool { return strings.HasSuffix(l, `from "`+m+`";`) }) {
						t.Errorf("%s doesn't import %q:\n%s", f.GetName(), m, f.GetContent())
					}
				}
			}
			if !reflect.DeepEqual(files, c.wantFiles) {
				t.Errorf("files = %q, want %q", files, c.wantFiles)
			}
		})
	}
}
