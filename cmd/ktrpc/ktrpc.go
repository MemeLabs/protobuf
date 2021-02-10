package main

import (
	"fmt"
	"strings"
	"text/template"

	pgs "github.com/lyft/protoc-gen-star"
)

// KtRPCModule ...
type KtRPCModule struct {
	*pgs.ModuleBase
	tpl *template.Template
}

// KtRPC ...
func KtRPC() *KtRPCModule { return &KtRPCModule{ModuleBase: &pgs.ModuleBase{}} }

// InitContext ...
func (p *KtRPCModule) InitContext(c pgs.BuildContext) {
	p.ModuleBase.InitContext(c)

	tpl := template.New("ktrpc").Funcs(map[string]interface{}{
		"package": p.PackageName,
	})

	p.tpl = template.Must(tpl.Parse(rpcTpl))
}

// Name satisfies the generator.Plugin interface.
func (p *KtRPCModule) Name() string { return "ktrpc" }

func (p *KtRPCModule) PackageName(f pgs.File) string { return *f.Descriptor().Options.JavaPackage }

// Execute ...
func (p *KtRPCModule) Execute(targets map[string]pgs.File, pkgs map[string]pgs.Package) []pgs.Artifact {
	for _, t := range targets {
		p.generate(t)
	}

	return p.Artifacts()
}

func (p *KtRPCModule) generate(f pgs.File) {
	if len(f.Services()) == 0 {
		return
	}

	pkg := *f.Descriptor().Options.JavaPackage
	path := strings.ReplaceAll(strings.TrimPrefix(pkg, "."), ".", "/")
	name := fmt.Sprintf("%s/%s.rpc.kt", path, f.File().InputPath().BaseName())
	p.Debugf("we are here yee %s", name)

	p.AddGeneratorTemplateFile(name, p.tpl, f)
}

// replace package name with file and path to import RPCClient
const rpcTpl = `package {{ package . }}

import gg.memelabs.protobuf.rpc.*

{{range .Services}}
class {{.Name}}Client(filepath: String) : RPCClient(filepath) {
{{range .Methods}}
    suspend fun {{.Name.UpperCamelCase}}(
        arg: {{.Input.Name}} = {{.Input.Name}}()
    ): {{if .ServerStreaming}}RPCResponseStream<{{.Output.Name}}>{{else}}{{.Output.Name}}{{end}} =
        this.{{if .ServerStreaming}}callStreaming{{else}}callUnary{{end}}("{{$.Name}}/{{.Name}}", arg)
{{end}}}
{{end}}
`
