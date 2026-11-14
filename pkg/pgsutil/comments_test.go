package pgsutil

import (
	"testing"

	pgs "github.com/lyft/protoc-gen-star/v2"
	descriptor "google.golang.org/protobuf/types/descriptorpb"
)

// info is a SourceCodeInfo holding comments as protoc reports them: markers
// stripped, the space after `//` kept, each line ending in "\n".
type info struct {
	leading, trailing string
	detached          []string
}

func (i info) Location() *descriptor.SourceCodeInfo_Location { return nil }
func (i info) LeadingComments() string                       { return i.leading }
func (i info) LeadingDetachedComments() []string             { return i.detached }
func (i info) TrailingComments() string                      { return i.trailing }

// entity and file stub the pgs interfaces; only the source info methods
// are implemented.
type entity struct {
	pgs.Entity
	info pgs.SourceCodeInfo
}

func (e entity) SourceCodeInfo() pgs.SourceCodeInfo { return e.info }

// pgsFile names the embedded field so it doesn't hide pgs.File's File
// method.
type pgsFile = pgs.File

type file struct {
	pgsFile
	syntax, pkg pgs.SourceCodeInfo
}

func (f file) SyntaxSourceCodeInfo() pgs.SourceCodeInfo  { return f.syntax }
func (f file) PackageSourceCodeInfo() pgs.SourceCodeInfo { return f.pkg }

func TestFileHeader(t *testing.T) {
	cases := []struct {
		name string
		f    file
		want string
	}{
		{
			name: "none",
			f:    file{},
			want: "",
		},
		{
			name: "no comments",
			f:    file{syntax: info{}, pkg: info{}},
			want: "",
		},
		{
			name: "license",
			f: file{syntax: info{detached: []string{
				" Copyright 2022 Strims contributors\n SPDX-License-Identifier: AGPL-3.0-only\n",
			}}},
			want: "// Copyright 2022 Strims contributors\n// SPDX-License-Identifier: AGPL-3.0-only\n\n",
		},
		{
			name: "blocks above syntax and package",
			f: file{
				syntax: info{detached: []string{" a\n", " b\n\n c\n"}, leading: " d\n"},
				pkg:    info{detached: []string{" e\n"}, leading: " f\n"},
			},
			want: "// a\n\n// b\n//\n// c\n\n// d\n\n// e\n\n// f\n\n",
		},
		{
			name: "indent and markerless lines kept",
			f:    file{syntax: info{detached: []string{"   indented\nno space\n"}}},
			want: "//   indented\n// no space\n\n",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := FileHeader(c.f); got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}
}

func TestCommentLines(t *testing.T) {
	cases := []struct {
		name string
		info pgs.SourceCodeInfo
		want []string
	}{
		{"nil", nil, nil},
		{"empty", info{}, nil},
		{"leading", info{leading: " a\n b\n"}, []string{"a", "b"}},
		{"trailing", info{trailing: " t\n"}, []string{"t"}},
		{"leading and trailing", info{leading: " a\n", trailing: " t\n"}, []string{"a", "", "t"}},
		{"detached left out", info{detached: []string{" d\n"}}, nil},
		{"block comment", info{leading: "\n a\n b \n"}, []string{"a", "b"}},
		{"blank line inside", info{leading: " a\n\n b\n"}, []string{"a", "", "b"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := CommentLines(c.info)
			if len(got) != len(c.want) {
				t.Fatalf("got %q, want %q", got, c.want)
			}
			for i := range got {
				if got[i] != c.want[i] {
					t.Fatalf("got %q, want %q", got, c.want)
				}
			}
		})
	}
}

func TestJSDoc(t *testing.T) {
	cases := []struct {
		name  string
		lines []string
		want  string
	}{
		{"none", nil, ""},
		{"one line", []string{"No code, or no error."}, "  /** No code, or no error. */\n"},
		{"lines", []string{"a", "", "b"}, "  /**\n   * a\n   *\n   * b\n   */\n"},
		{"comment end escaped", []string{"a */ b"}, "  /** a *\\/ b */\n"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := JSDoc(c.lines, "  "); got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}
}

func TestDocKeepsIndent(t *testing.T) {
	var g Generator
	g.Line("class A {")
	g.Doc(entity{info: info{leading: " braces { in { a comment\n"}})
	g.Line("b: number;")
	g.Doc(entity{})
	g.Line("}")
	g.Line("c;")

	want := "class A {\n  /** braces { in { a comment */\n  b: number;\n}\nc;\n"
	if got := g.String(); got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}
