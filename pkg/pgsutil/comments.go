package pgsutil

import (
	"strings"

	pgs "github.com/lyft/protoc-gen-star/v2"
)

// splitComment splits a comment as protoc reports it (markers stripped, one
// line per source line) into lines. It drops the space protoc leaves after
// each `//`, trailing whitespace, and blank lines at either end.
func splitComment(c string) []string {
	lines := strings.Split(c, "\n")
	for i, l := range lines {
		lines[i] = strings.TrimRight(strings.TrimPrefix(l, " "), " \t\r")
	}
	for len(lines) != 0 && lines[0] == "" {
		lines = lines[1:]
	}
	for len(lines) != 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

// CommentLines returns the comment attached to an entity: its leading
// comment, then its trailing comment, separated by a blank line. Detached
// comments are left out, as protoc-gen-go leaves them out. info may be nil
// for entities protoc sent without source info.
func CommentLines(info pgs.SourceCodeInfo) []string {
	if info == nil {
		return nil
	}
	lines := splitComment(info.LeadingComments())
	if trailing := splitComment(info.TrailingComments()); len(trailing) != 0 {
		if len(lines) != 0 {
			lines = append(lines, "")
		}
		lines = append(lines, trailing...)
	}
	return lines
}

// headerBlocks returns the comment blocks above a file's syntax and package
// statements: each one's detached comments, then its leading comment.
func headerBlocks(infos ...pgs.SourceCodeInfo) [][]string {
	var blocks [][]string
	add := func(c string) {
		if lines := splitComment(c); len(lines) != 0 {
			blocks = append(blocks, lines)
		}
	}
	for _, info := range infos {
		if info == nil {
			continue
		}
		for _, c := range info.LeadingDetachedComments() {
			add(c)
		}
		add(info.LeadingComments())
	}
	return blocks
}

// FileHeader returns the comments at the top of a proto file (a license
// header, say) as `//` comment blocks, each followed by a blank line, as
// protoc-gen-go copies them to the top of its output. It returns "" for a
// file with none.
func FileHeader(f pgs.File) string {
	var b strings.Builder
	for _, block := range headerBlocks(f.SyntaxSourceCodeInfo(), f.PackageSourceCodeInfo()) {
		b.WriteString(LineComment(block, ""))
		b.WriteString("\n")
	}
	return b.String()
}

// LineComment formats lines as `//` comments, each line prefixed with
// indent and ending in a newline.
func LineComment(lines []string, indent string) string {
	var b strings.Builder
	for _, l := range lines {
		b.WriteString(indent)
		b.WriteString("//")
		if l != "" {
			b.WriteString(" ")
			b.WriteString(l)
		}
		b.WriteString("\n")
	}
	return b.String()
}

// JSDoc formats lines as a JSDoc block, each line prefixed with indent and
// ending in a newline: `/** text */` for one line, a `/** … */` block for
// more. A `*/` in the text, which would end the block, becomes `*\/`.
func JSDoc(lines []string, indent string) string {
	if len(lines) == 0 {
		return ""
	}
	esc := func(s string) string { return strings.ReplaceAll(s, "*/", `*\/`) }
	if len(lines) == 1 {
		return indent + "/** " + esc(lines[0]) + " */\n"
	}
	var b strings.Builder
	b.WriteString(indent + "/**\n")
	for _, l := range lines {
		if l == "" {
			b.WriteString(indent + " *\n")
		} else {
			b.WriteString(indent + " * " + esc(l) + "\n")
		}
	}
	b.WriteString(indent + " */\n")
	return b.String()
}

// Doc writes e's comment as a JSDoc block at the current indent. It doesn't
// go through Line, which would count the braces in the comment's text
// toward the indent.
func (g *Generator) Doc(e pgs.Entity) {
	g.WriteString(JSDoc(CommentLines(e.SourceCodeInfo()), strings.Repeat("  ", g.indent)))
}

// Header writes f's header comments (see FileHeader).
func (g *Generator) Header(f pgs.File) {
	g.WriteString(FileHeader(f))
}
