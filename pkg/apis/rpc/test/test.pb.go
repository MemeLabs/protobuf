// Code generated by protoc-gen-go. DO NOT EDIT.
// versions:
// 	protoc-gen-go v1.23.0
// 	protoc        v3.14.0
// source: rpc/test/test.proto

package test

import (
	proto "github.com/golang/protobuf/proto"
	protoreflect "google.golang.org/protobuf/reflect/protoreflect"
	protoimpl "google.golang.org/protobuf/runtime/protoimpl"
	reflect "reflect"
	sync "sync"
)

const (
	// Verify that this generated code is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(20 - protoimpl.MinVersion)
	// Verify that runtime/protoimpl is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(protoimpl.MaxVersion - 20)
)

// This is a compile-time assertion that a sufficiently up-to-date version
// of the legacy proto package is being used.
const _ = proto.ProtoPackageIsVersion4

type RPCCallUnaryRequest struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Id uint64 `protobuf:"varint,1,opt,name=id,proto3" json:"id,omitempty"`
}

func (x *RPCCallUnaryRequest) Reset() {
	*x = RPCCallUnaryRequest{}
	if protoimpl.UnsafeEnabled {
		mi := &file_rpc_test_test_proto_msgTypes[0]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *RPCCallUnaryRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*RPCCallUnaryRequest) ProtoMessage() {}

func (x *RPCCallUnaryRequest) ProtoReflect() protoreflect.Message {
	mi := &file_rpc_test_test_proto_msgTypes[0]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use RPCCallUnaryRequest.ProtoReflect.Descriptor instead.
func (*RPCCallUnaryRequest) Descriptor() ([]byte, []int) {
	return file_rpc_test_test_proto_rawDescGZIP(), []int{0}
}

func (x *RPCCallUnaryRequest) GetId() uint64 {
	if x != nil {
		return x.Id
	}
	return 0
}

type RPCCallUnaryResponse struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Id uint64 `protobuf:"varint,1,opt,name=id,proto3" json:"id,omitempty"`
}

func (x *RPCCallUnaryResponse) Reset() {
	*x = RPCCallUnaryResponse{}
	if protoimpl.UnsafeEnabled {
		mi := &file_rpc_test_test_proto_msgTypes[1]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *RPCCallUnaryResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*RPCCallUnaryResponse) ProtoMessage() {}

func (x *RPCCallUnaryResponse) ProtoReflect() protoreflect.Message {
	mi := &file_rpc_test_test_proto_msgTypes[1]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use RPCCallUnaryResponse.ProtoReflect.Descriptor instead.
func (*RPCCallUnaryResponse) Descriptor() ([]byte, []int) {
	return file_rpc_test_test_proto_rawDescGZIP(), []int{1}
}

func (x *RPCCallUnaryResponse) GetId() uint64 {
	if x != nil {
		return x.Id
	}
	return 0
}

type RPCCallStreamRequest struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Id    uint64 `protobuf:"varint,1,opt,name=id,proto3" json:"id,omitempty"`
	Count uint64 `protobuf:"varint,2,opt,name=count,proto3" json:"count,omitempty"`
}

func (x *RPCCallStreamRequest) Reset() {
	*x = RPCCallStreamRequest{}
	if protoimpl.UnsafeEnabled {
		mi := &file_rpc_test_test_proto_msgTypes[2]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *RPCCallStreamRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*RPCCallStreamRequest) ProtoMessage() {}

func (x *RPCCallStreamRequest) ProtoReflect() protoreflect.Message {
	mi := &file_rpc_test_test_proto_msgTypes[2]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use RPCCallStreamRequest.ProtoReflect.Descriptor instead.
func (*RPCCallStreamRequest) Descriptor() ([]byte, []int) {
	return file_rpc_test_test_proto_rawDescGZIP(), []int{2}
}

func (x *RPCCallStreamRequest) GetId() uint64 {
	if x != nil {
		return x.Id
	}
	return 0
}

func (x *RPCCallStreamRequest) GetCount() uint64 {
	if x != nil {
		return x.Count
	}
	return 0
}

type RPCCallStreamResponse struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Id uint64 `protobuf:"varint,1,opt,name=id,proto3" json:"id,omitempty"`
}

func (x *RPCCallStreamResponse) Reset() {
	*x = RPCCallStreamResponse{}
	if protoimpl.UnsafeEnabled {
		mi := &file_rpc_test_test_proto_msgTypes[3]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *RPCCallStreamResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*RPCCallStreamResponse) ProtoMessage() {}

func (x *RPCCallStreamResponse) ProtoReflect() protoreflect.Message {
	mi := &file_rpc_test_test_proto_msgTypes[3]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use RPCCallStreamResponse.ProtoReflect.Descriptor instead.
func (*RPCCallStreamResponse) Descriptor() ([]byte, []int) {
	return file_rpc_test_test_proto_rawDescGZIP(), []int{3}
}

func (x *RPCCallStreamResponse) GetId() uint64 {
	if x != nil {
		return x.Id
	}
	return 0
}

var File_rpc_test_test_proto protoreflect.FileDescriptor

var file_rpc_test_test_proto_rawDesc = []byte{
	0x0a, 0x13, 0x72, 0x70, 0x63, 0x2f, 0x74, 0x65, 0x73, 0x74, 0x2f, 0x74, 0x65, 0x73, 0x74, 0x2e,
	0x70, 0x72, 0x6f, 0x74, 0x6f, 0x12, 0x0f, 0x73, 0x74, 0x72, 0x69, 0x6d, 0x73, 0x2e, 0x72, 0x70,
	0x63, 0x2e, 0x74, 0x65, 0x73, 0x74, 0x22, 0x25, 0x0a, 0x13, 0x52, 0x50, 0x43, 0x43, 0x61, 0x6c,
	0x6c, 0x55, 0x6e, 0x61, 0x72, 0x79, 0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x12, 0x0e, 0x0a,
	0x02, 0x69, 0x64, 0x18, 0x01, 0x20, 0x01, 0x28, 0x04, 0x52, 0x02, 0x69, 0x64, 0x22, 0x26, 0x0a,
	0x14, 0x52, 0x50, 0x43, 0x43, 0x61, 0x6c, 0x6c, 0x55, 0x6e, 0x61, 0x72, 0x79, 0x52, 0x65, 0x73,
	0x70, 0x6f, 0x6e, 0x73, 0x65, 0x12, 0x0e, 0x0a, 0x02, 0x69, 0x64, 0x18, 0x01, 0x20, 0x01, 0x28,
	0x04, 0x52, 0x02, 0x69, 0x64, 0x22, 0x3c, 0x0a, 0x14, 0x52, 0x50, 0x43, 0x43, 0x61, 0x6c, 0x6c,
	0x53, 0x74, 0x72, 0x65, 0x61, 0x6d, 0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x12, 0x0e, 0x0a,
	0x02, 0x69, 0x64, 0x18, 0x01, 0x20, 0x01, 0x28, 0x04, 0x52, 0x02, 0x69, 0x64, 0x12, 0x14, 0x0a,
	0x05, 0x63, 0x6f, 0x75, 0x6e, 0x74, 0x18, 0x02, 0x20, 0x01, 0x28, 0x04, 0x52, 0x05, 0x63, 0x6f,
	0x75, 0x6e, 0x74, 0x22, 0x27, 0x0a, 0x15, 0x52, 0x50, 0x43, 0x43, 0x61, 0x6c, 0x6c, 0x53, 0x74,
	0x72, 0x65, 0x61, 0x6d, 0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e, 0x73, 0x65, 0x12, 0x0e, 0x0a, 0x02,
	0x69, 0x64, 0x18, 0x01, 0x20, 0x01, 0x28, 0x04, 0x52, 0x02, 0x69, 0x64, 0x32, 0xc2, 0x01, 0x0a,
	0x07, 0x52, 0x50, 0x43, 0x54, 0x65, 0x73, 0x74, 0x12, 0x58, 0x0a, 0x09, 0x43, 0x61, 0x6c, 0x6c,
	0x55, 0x6e, 0x61, 0x72, 0x79, 0x12, 0x24, 0x2e, 0x73, 0x74, 0x72, 0x69, 0x6d, 0x73, 0x2e, 0x72,
	0x70, 0x63, 0x2e, 0x74, 0x65, 0x73, 0x74, 0x2e, 0x52, 0x50, 0x43, 0x43, 0x61, 0x6c, 0x6c, 0x55,
	0x6e, 0x61, 0x72, 0x79, 0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x1a, 0x25, 0x2e, 0x73, 0x74,
	0x72, 0x69, 0x6d, 0x73, 0x2e, 0x72, 0x70, 0x63, 0x2e, 0x74, 0x65, 0x73, 0x74, 0x2e, 0x52, 0x50,
	0x43, 0x43, 0x61, 0x6c, 0x6c, 0x55, 0x6e, 0x61, 0x72, 0x79, 0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e,
	0x73, 0x65, 0x12, 0x5d, 0x0a, 0x0a, 0x43, 0x61, 0x6c, 0x6c, 0x53, 0x74, 0x72, 0x65, 0x61, 0x6d,
	0x12, 0x25, 0x2e, 0x73, 0x74, 0x72, 0x69, 0x6d, 0x73, 0x2e, 0x72, 0x70, 0x63, 0x2e, 0x74, 0x65,
	0x73, 0x74, 0x2e, 0x52, 0x50, 0x43, 0x43, 0x61, 0x6c, 0x6c, 0x53, 0x74, 0x72, 0x65, 0x61, 0x6d,
	0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x1a, 0x26, 0x2e, 0x73, 0x74, 0x72, 0x69, 0x6d, 0x73,
	0x2e, 0x72, 0x70, 0x63, 0x2e, 0x74, 0x65, 0x73, 0x74, 0x2e, 0x52, 0x50, 0x43, 0x43, 0x61, 0x6c,
	0x6c, 0x53, 0x74, 0x72, 0x65, 0x61, 0x6d, 0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e, 0x73, 0x65, 0x30,
	0x01, 0x42, 0x5b, 0x0a, 0x1e, 0x6f, 0x72, 0x67, 0x2e, 0x6d, 0x65, 0x6d, 0x65, 0x6c, 0x61, 0x62,
	0x73, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x62, 0x75, 0x66, 0x2e, 0x72, 0x70, 0x63, 0x2e, 0x74,
	0x65, 0x73, 0x74, 0x5a, 0x33, 0x67, 0x69, 0x74, 0x68, 0x75, 0x62, 0x2e, 0x63, 0x6f, 0x6d, 0x2f,
	0x4d, 0x65, 0x6d, 0x65, 0x4c, 0x61, 0x62, 0x73, 0x2f, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x62, 0x75,
	0x66, 0x2f, 0x70, 0x6b, 0x67, 0x2f, 0x61, 0x70, 0x69, 0x73, 0x2f, 0x72, 0x70, 0x63, 0x2f, 0x74,
	0x65, 0x73, 0x74, 0x3b, 0x74, 0x65, 0x73, 0x74, 0xba, 0x02, 0x03, 0x53, 0x52, 0x54, 0x62, 0x06,
	0x70, 0x72, 0x6f, 0x74, 0x6f, 0x33,
}

var (
	file_rpc_test_test_proto_rawDescOnce sync.Once
	file_rpc_test_test_proto_rawDescData = file_rpc_test_test_proto_rawDesc
)

func file_rpc_test_test_proto_rawDescGZIP() []byte {
	file_rpc_test_test_proto_rawDescOnce.Do(func() {
		file_rpc_test_test_proto_rawDescData = protoimpl.X.CompressGZIP(file_rpc_test_test_proto_rawDescData)
	})
	return file_rpc_test_test_proto_rawDescData
}

var file_rpc_test_test_proto_msgTypes = make([]protoimpl.MessageInfo, 4)
var file_rpc_test_test_proto_goTypes = []interface{}{
	(*RPCCallUnaryRequest)(nil),   // 0: strims.rpc.test.RPCCallUnaryRequest
	(*RPCCallUnaryResponse)(nil),  // 1: strims.rpc.test.RPCCallUnaryResponse
	(*RPCCallStreamRequest)(nil),  // 2: strims.rpc.test.RPCCallStreamRequest
	(*RPCCallStreamResponse)(nil), // 3: strims.rpc.test.RPCCallStreamResponse
}
var file_rpc_test_test_proto_depIdxs = []int32{
	0, // 0: strims.rpc.test.RPCTest.CallUnary:input_type -> strims.rpc.test.RPCCallUnaryRequest
	2, // 1: strims.rpc.test.RPCTest.CallStream:input_type -> strims.rpc.test.RPCCallStreamRequest
	1, // 2: strims.rpc.test.RPCTest.CallUnary:output_type -> strims.rpc.test.RPCCallUnaryResponse
	3, // 3: strims.rpc.test.RPCTest.CallStream:output_type -> strims.rpc.test.RPCCallStreamResponse
	2, // [2:4] is the sub-list for method output_type
	0, // [0:2] is the sub-list for method input_type
	0, // [0:0] is the sub-list for extension type_name
	0, // [0:0] is the sub-list for extension extendee
	0, // [0:0] is the sub-list for field type_name
}

func init() { file_rpc_test_test_proto_init() }
func file_rpc_test_test_proto_init() {
	if File_rpc_test_test_proto != nil {
		return
	}
	if !protoimpl.UnsafeEnabled {
		file_rpc_test_test_proto_msgTypes[0].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*RPCCallUnaryRequest); i {
			case 0:
				return &v.state
			case 1:
				return &v.sizeCache
			case 2:
				return &v.unknownFields
			default:
				return nil
			}
		}
		file_rpc_test_test_proto_msgTypes[1].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*RPCCallUnaryResponse); i {
			case 0:
				return &v.state
			case 1:
				return &v.sizeCache
			case 2:
				return &v.unknownFields
			default:
				return nil
			}
		}
		file_rpc_test_test_proto_msgTypes[2].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*RPCCallStreamRequest); i {
			case 0:
				return &v.state
			case 1:
				return &v.sizeCache
			case 2:
				return &v.unknownFields
			default:
				return nil
			}
		}
		file_rpc_test_test_proto_msgTypes[3].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*RPCCallStreamResponse); i {
			case 0:
				return &v.state
			case 1:
				return &v.sizeCache
			case 2:
				return &v.unknownFields
			default:
				return nil
			}
		}
	}
	type x struct{}
	out := protoimpl.TypeBuilder{
		File: protoimpl.DescBuilder{
			GoPackagePath: reflect.TypeOf(x{}).PkgPath(),
			RawDescriptor: file_rpc_test_test_proto_rawDesc,
			NumEnums:      0,
			NumMessages:   4,
			NumExtensions: 0,
			NumServices:   1,
		},
		GoTypes:           file_rpc_test_test_proto_goTypes,
		DependencyIndexes: file_rpc_test_test_proto_depIdxs,
		MessageInfos:      file_rpc_test_test_proto_msgTypes,
	}.Build()
	File_rpc_test_test_proto = out.File
	file_rpc_test_test_proto_rawDesc = nil
	file_rpc_test_test_proto_goTypes = nil
	file_rpc_test_test_proto_depIdxs = nil
}
