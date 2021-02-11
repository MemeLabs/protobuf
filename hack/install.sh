#!/bin/bash

set -e
pushd $(/bin/pwd) > /dev/null

BASE="$(realpath $0)"
cd "$(dirname $BASE)"

go build -o protoc-gen-ts ../cmd/ts/
go build -o protoc-gen-gorpc ../cmd/gorpc/
go build -o protoc-gen-tsrpc ../cmd/tsrpc/
go build -o protoc-gen-ktrpc ../cmd/ktrpc/

sudo mv protoc-gen-* /usr/local/bin/

popd > /dev/null
