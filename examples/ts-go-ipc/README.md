```
npx ts-node client.ts
```

```
protoc \
	--proto_path=./proto \
	--go_out=pkg/apis \
	--go_opt=module=github.com/MemeLabs/protobuf/examples/ts-go-ipc/pkg/apis \
	--gorpc_out=pkg/apis \
	--gorpc_opt=module=github.com/MemeLabs/protobuf/examples/ts-go-ipc/pkg/apis \
	--ts_out=src/apis \
	--tsrpc_out=src/apis \
	greeter.proto ticker.proto
```
