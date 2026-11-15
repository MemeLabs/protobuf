package main

import (
	"fmt"
	"sort"
	"strings"
	"text/template"

	"github.com/MemeLabs/protobuf/pkg/pgsutil"
	pgs "github.com/lyft/protoc-gen-star/v2"
	pgsgo "github.com/lyft/protoc-gen-star/v2/lang/go"
)

// GoRPCModule ...
type GoRPCModule struct {
	*pgs.ModuleBase
	ctx pgsgo.Context
	tpl *template.Template
}

// GoRPC ...
func GoRPC() *GoRPCModule { return &GoRPCModule{ModuleBase: &pgs.ModuleBase{}} }

// InitContext ...
func (p *GoRPCModule) InitContext(c pgs.BuildContext) {
	p.ModuleBase.InitContext(c)
	p.ctx = pgsgo.InitContext(c.Parameters())

	tpl := template.New("gorpc").Funcs(map[string]interface{}{
		"package":  p.ctx.PackageName,
		"name":     p.ctx.Name,
		"fullName": p.fullName,
		"header":   pgsutil.FileHeader,
		"doc":      p.doc,
	})

	p.tpl = template.Must(tpl.Parse(rpcTpl))
}

// Name satisfies the generator.Plugin interface.
func (p *GoRPCModule) Name() string { return "gorpc" }

// Execute ...
func (p *GoRPCModule) Execute(targets map[string]pgs.File, pkgs map[string]pgs.Package) []pgs.Artifact {
	// sorted, so errors come out in a stable order
	files := make([]pgs.File, 0, len(targets))
	for _, t := range targets {
		files = append(files, t)
	}
	sort.Slice(files, func(i, j int) bool { return files[i].InputPath() < files[j].InputPath() })

	ok := true
	for _, f := range files {
		ok = p.checkMethods(f) && ok
	}
	if !ok {
		return p.Artifacts()
	}

	for _, f := range files {
		p.generate(f)
	}

	return p.Artifacts()
}

// checkMethods adds an error for each client-streaming or bidirectional
// method in f, which pkg/rpc doesn't support, and reports whether f had none.
func (p *GoRPCModule) checkMethods(f pgs.File) bool {
	ok := true
	for _, s := range f.Services() {
		for _, m := range s.Methods() {
			if m.ClientStreaming() {
				p.AddError(fmt.Sprintf("%s: %s.%s: client-streaming and bidirectional methods are not supported (only unary and server-streaming)", f.InputPath(), p.fullName(s), m.Name()))
				ok = false
			}
		}
	}
	return ok
}

func (p *GoRPCModule) generate(f pgs.File) {
	if len(f.Services()) == 0 {
		return
	}

	name := p.ctx.OutputPath(f).SetExt(".rpc.go").String()
	name = strings.TrimPrefix(strings.TrimPrefix(name, p.ctx.Params().Str("module")), "/")
	p.AddGeneratorTemplateFile(name, p.tpl, f)
}

func (p *GoRPCModule) fullName(e pgs.Entity) string {
	return strings.TrimPrefix(e.FullyQualifiedName(), ".")
}

// doc returns e's proto comment as a Go doc comment, or fallback as one
// when e has none ("" for no comment).
func (p *GoRPCModule) doc(e pgs.Entity, fallback string) string {
	lines := pgsutil.CommentLines(e.SourceCodeInfo())
	if len(lines) == 0 && fallback != "" {
		lines = []string{fallback}
	}
	return pgsutil.LineComment(lines, "")
}

const rpcTpl = `{{ header . }}package {{ package . }}

import (
	"context"

	"github.com/MemeLabs/protobuf/pkg/rpc"
)

{{range .Services}}
{{$svcName := .Name.UpperCamelCase}}
// Register{{$svcName}}Service ...
func Register{{$svcName}}Service(host rpc.ServiceRegistry, service {{$svcName}}Service) {
{{range .Methods}}  host.RegisterMethod("{{. | fullName}}", service.{{.Name.UpperCamelCase}})
{{end}}}

{{ doc . (printf "%sService ..." $svcName) }}type {{$svcName}}Service interface {
{{range .Methods}}{{ doc . "" }}  {{.Name.UpperCamelCase}} (
	  ctx context.Context,
	  req *{{.Input.Name.UpperCamelCase}},
  ) ({{if .ServerStreaming}}<-chan {{end}}*{{.Output.Name.UpperCamelCase}}, error)
{{end}}}

// Unimplemented{{$svcName}}Service ...
type Unimplemented{{$svcName}}Service struct {}
{{range .Methods}}
func (s *Unimplemented{{$svcName}}Service) {{.Name.UpperCamelCase}} (
	  ctx context.Context,
	  req *{{.Input.Name.UpperCamelCase}},
  ) ({{if .ServerStreaming}}<-chan {{end}}*{{.Output.Name.UpperCamelCase}}, error) {
	return nil, rpc.ErrNotImplemented
}
{{end}}

var _ {{$svcName}}Service = (*Unimplemented{{$svcName}}Service)(nil)

// {{$svcName}}Client ...
type {{$svcName}}Client struct {
	client rpc.Caller
}

// New{{$svcName}}Client ...
func New{{$svcName}}Client(client rpc.Caller) *{{$svcName}}Client {
	return &{{$svcName}}Client{client}
}
{{range .Methods}}
{{ doc . (printf "%s ..." .Name.UpperCamelCase) }}func (c *{{$svcName}}Client) {{.Name.UpperCamelCase}} (
	ctx context.Context,
	req *{{.Input.Name.UpperCamelCase}},
	res {{if .ServerStreaming}}chan {{end}}*{{.Output.Name.UpperCamelCase}},
) error {
	return c.client.{{if .ServerStreaming}}CallStreaming{{else}}CallUnary{{end}}(ctx, "{{. | fullName}}", req, res)
}
{{end}}
{{end}}
`
