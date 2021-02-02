#!/bin/bash

go build -o protoc-gen-ts ./cmd/ts/
go build -o protoc-gen-gorpc ./cmd/gorpc/
go build -o protoc-gen-tsrpc ./cmd/tsrpc/

SOURCES="$(find ./proto -iname *.proto)"
PATH="${pwd}:$PATH" protoc \
  --proto_path=./proto \
  --go_out=./pkg/apis \
  --go_opt=module=github.com/MemeLabs/protobuf/pkg/apis \
  --gorpc_out=./pkg/apis \
  --gorpc_opt=module=github.com/MemeLabs/protobuf/pkg/apis \
  --ts_out=./src/apis \
  --tsrpc_out=./src/apis \
  $SOURCES
