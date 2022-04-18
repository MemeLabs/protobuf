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

	for _, s := range f.Services() {
		g.generateService(s)
	}
}

func (g *generator) fullName(e pgs.Entity) string {
	return strings.TrimPrefix(e.FullyQualifiedName(), ".")
}

func (g *generator) hasUnaryMethod(s pgs.Service) bool {
	for _, m := range s.Methods() {
		if !m.ServerStreaming() {
			return true
		}
	}
	return false
}

func (g *generator) generateImports(f pgs.File) {
	root := g.runtimePath + "/lib/"
	if g.runtimePath == "self" {
		root = strings.Repeat("../", strings.Count(f.File().FullyQualifiedName(), ".")+1)
	}

	hostExports := ""
	for _, s := range f.Services() {
		if g.hasUnaryMethod(s) {
			hostExports = ", { UnaryCallOptions as strims_rpc_UnaryCallOptions }"
			break
		}
	}

	g.Linef(`import strims_rpc_Host%s from "%srpc/host";`, hostExports, root)
	g.Linef(`import strims_rpc_Service from "%srpc/service";`, root)
	g.Linef(`import { Call as strims_rpc_Call } from "%sapis/strims/rpc/rpc";`, root)

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

func (g *generator) generateService(s pgs.Service) {
	g.Linef(`export interface %sService {`, s.Name().UpperCamelCase())
	for _, m := range s.Methods() {
		input := m.Input().Name().String()
		output := m.Output().Name().UpperCamelCase().String()
		if m.ServerStreaming() {
			output = fmt.Sprintf("GenericReadable<%s>", output)
		} else {
			output = fmt.Sprintf("Promise<%[1]s> | %[1]s", output)
		}

		g.Linef(`%s(req: %s, call: strims_rpc_Call): %s;`, m.Name().LowerCamelCase(), input, output)
	}
	g.Line(`}`)
	g.LineBreak()

	g.Linef(`export class Unimplemented%[1]sService implements %[1]sService {`, s.Name().UpperCamelCase())
	for _, m := range s.Methods() {
		input := m.Input().Name().String()
		output := m.Output().Name().UpperCamelCase().String()
		if m.ServerStreaming() {
			output = fmt.Sprintf("GenericReadable<%s>", output)
		} else {
			output = fmt.Sprintf("Promise<%[1]s> | %[1]s", output)
		}

		g.Linef(`%s(req: %s, call: strims_rpc_Call): %s { throw new Error("not implemented"); }`, m.Name().LowerCamelCase(), input, output)
	}
	g.Line(`}`)
	g.LineBreak()

	g.Linef(`export const register%[1]sService = (host: strims_rpc_Service, service: %[1]sService): void => {`, s.Name().UpperCamelCase())
	for _, m := range s.Methods() {
		input := m.Input().Name().String()
		output := m.Output().Name().UpperCamelCase().String()
		g.Linef(`host.registerMethod<%s, %s>("%s", service.%s.bind(service), %s);`, input, output, g.fullName(m), m.Name().LowerCamelCase(), input)
	}
	g.Line(`}`)
	g.LineBreak()

	g.Linef(`export class %sClient {`, s.Name().UpperCamelCase())
	g.Line(`constructor(private readonly host: strims_rpc_Host) {}`)
	for _, m := range s.Methods() {
		input := m.Input().Name().String()
		output := m.Output().Name().UpperCamelCase().String()

		g.LineBreak()
		if m.ServerStreaming() {
			g.Linef(`public %s(req?: I%s): GenericReadable<%s> {`, m.Name().LowerCamelCase(), input, output)
			g.Linef(`return this.host.expectMany(this.host.call("%s", new %s(req)), %s);`, g.fullName(m), input, output)
		} else {
			g.Linef(`public %s(req?: I%s, opts?: strims_rpc_UnaryCallOptions): Promise<%s> {`, m.Name().LowerCamelCase(), input, output)
			g.Linef(`return this.host.expectOne(this.host.call("%s", new %s(req)), %s, opts);`, g.fullName(m), input, output)
		}
		g.Line(`}`)
	}
	g.Line(`}`)
	g.LineBreak()
}
