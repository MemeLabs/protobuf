package main

import (
	pgs "github.com/lyft/protoc-gen-star/v2"
)

func main() {
	pgs.Init(
		pgs.DebugEnv("DEBUG"),
	).RegisterModule(
		TS(),
	).Render()
}
