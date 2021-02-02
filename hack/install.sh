#!/bin/bash

set -e
pushd $(/bin/pwd) > /dev/null

BASE="$(realpath $0)"
cd "$(dirname $BASE)"

go build -o protoc-gen-ts ../cmd/ts/
go build -o protoc-gen-gorpc ../cmd/gorpc/
go build -o protoc-gen-tsrpc ../cmd/tsrpc/

sudo mv protoc-gen-ts /usr/local/bin/protoc-gen-ts
sudo mv protoc-gen-gorpc /usr/local/bin/protoc-gen-gorpc
sudo mv protoc-gen-tsrpc /usr/local/bin/protoc-gen-tsrpc

popd > /dev/null
