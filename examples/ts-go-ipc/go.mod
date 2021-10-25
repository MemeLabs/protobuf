module github.com/MemeLabs/protobuf/examples/ts-go-ipc

go 1.16

replace github.com/MemeLabs/protobuf => ../../

require (
	github.com/MemeLabs/protobuf v0.1.15
	github.com/golang/protobuf v1.5.2 // indirect
	go.uber.org/zap v1.16.0
	google.golang.org/protobuf v1.26.0
)
