package main

import (
	"fmt"
	"strings"

	"github.com/MemeLabs/protobuf/pkg/pgsutil"
	"github.com/MemeLabs/protobuf/pkg/ts"
	pgs "github.com/lyft/protoc-gen-star"
)

// TSRPCModule ...
type TSRPCModule struct {
	*pgs.ModuleBase
	c ts.Context
}

// TSRPC ...
func TSRPC() *TSRPCModule { return &TSRPCModule{ModuleBase: &pgs.ModuleBase{}} }

// InitContext ...
func (p *TSRPCModule) InitContext(c pgs.BuildContext) {
	p.ModuleBase.InitContext(c)
	p.c = ts.Context{BuildContext: c}
}

// Name satisfies the generator.Plugin interface.
func (p *TSRPCModule) Name() string { return "tsrpc" }

// Execute ...
func (p *TSRPCModule) Execute(targets map[string]pgs.File, pkgs map[string]pgs.Package) []pgs.Artifact {
	for _, pkg := range pkgs {
		for _, f := range pkg.Files() {
			if len(f.Services()) != 0 {
				p.generate(f)
			}
		}
	}

	return p.Artifacts()
}

func (p *TSRPCModule) generate(f pgs.File) {
	path := strings.ReplaceAll(strings.TrimPrefix(f.FullyQualifiedName(), "."), ".", "/")
	name := fmt.Sprintf("%s/%s_rpc.ts", path, f.File().InputPath().BaseName())

	g := &generator{
		runtimePath: p.c.RuntimePath(),
	}
	g.generateFile(f)

	p.AddGeneratorFile(name, g.String())
}

type generator struct {
	pgsutil.Generator
	runtimePath string
}

func (g *generator) generateFile(f pgs.File) {
	g.generateImports(f)
	g.generateTypeRegistration(f)

	for _, s := range f.Services() {
		g.generateService(s)
	}
}

func (g *generator) fullName(e pgs.Entity) string {
	return strings.TrimPrefix(e.FullyQualifiedName(), ".")
}

func (g *generator) generateImports(f pgs.File) {
	root := g.runtimePath + "/lib/"
	if g.runtimePath == "self" {
		root = strings.Repeat("../", strings.Count(f.File().FullyQualifiedName(), ".")+1)
	}

	g.Linef(`import { RPCHost } from "%srpc/host";`, root)
	g.Linef(`import { registerType } from "%srpc/registry";`, root)

EachService:
	for _, s := range f.Services() {
		for _, m := range s.Methods() {
			if m.ServerStreaming() {
				g.Linef(`import { Readable as GenericReadable } from "%srpc/stream";`, root)
				break EachService
			}
		}
	}

	g.LineBreak()

	g.Line(`import {`)
	for _, s := range f.Services() {
		for _, m := range s.Methods() {
			g.Linef(`I%s,`, m.Input().Name())
			g.Linef(`%s,`, m.Input().Name())
			g.Linef(`%s,`, m.Output().Name())
		}
	}
	g.Linef(`} from "./%s";`, f.File().InputPath().BaseName())
	g.LineBreak()
}

func (g *generator) generateTypeRegistration(f pgs.File) {
	for _, s := range f.Services() {
		for _, m := range s.Methods() {
			g.Linef(`registerType("%s", %s);`, g.fullName(m.Input()), m.Input().Name())
			g.Linef(`registerType("%s", %s);`, g.fullName(m.Output()), m.Output().Name())
		}
	}
	g.LineBreak()
}

func (g *generator) generateService(s pgs.Service) {
	g.Linef(`export class %sClient {`, s.Name().UpperCamelCase())
	g.Line(`constructor(private readonly host: RPCHost) {}`)
	for _, m := range s.Methods() {
		input := m.Input().Name().String()
		output := m.Output().Name().UpperCamelCase().String()

		g.LineBreak()
		if m.ServerStreaming() {
			g.Linef(`public %s(arg?: I%s): GenericReadable<%s> {`, m.Name().LowerCamelCase(), input, output)
			g.Linef(`return this.host.expectMany(this.host.call("%s", new %s(arg)));`, g.fullName(m), input)
		} else {
			g.Linef(`public %s(arg?: I%s): Promise<%s> {`, m.Name().LowerCamelCase(), input, output)
			g.Linef(`return this.host.expectOne(this.host.call("%s", new %s(arg)));`, g.fullName(m), input)
		}
		g.Line(`}`)
	}
	g.Line(`}`)
	g.LineBreak()
}
