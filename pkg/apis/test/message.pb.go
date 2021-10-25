// Code generated by protoc-gen-go. DO NOT EDIT.
// versions:
// 	protoc-gen-go v1.26.0
// 	protoc        v3.14.0
// source: test/message.proto

package test

import (
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

type TestMessage_TestEnum int32

const (
	TestMessage_TEST_ENUM_VAL_0 TestMessage_TestEnum = 0
	TestMessage_TEST_ENUM_VAL_1 TestMessage_TestEnum = 1
	TestMessage_TEST_ENUM_VAL_2 TestMessage_TestEnum = 2
)

// Enum value maps for TestMessage_TestEnum.
var (
	TestMessage_TestEnum_name = map[int32]string{
		0: "TEST_ENUM_VAL_0",
		1: "TEST_ENUM_VAL_1",
		2: "TEST_ENUM_VAL_2",
	}
	TestMessage_TestEnum_value = map[string]int32{
		"TEST_ENUM_VAL_0": 0,
		"TEST_ENUM_VAL_1": 1,
		"TEST_ENUM_VAL_2": 2,
	}
)

func (x TestMessage_TestEnum) Enum() *TestMessage_TestEnum {
	p := new(TestMessage_TestEnum)
	*p = x
	return p
}

func (x TestMessage_TestEnum) String() string {
	return protoimpl.X.EnumStringOf(x.Descriptor(), protoreflect.EnumNumber(x))
}

func (TestMessage_TestEnum) Descriptor() protoreflect.EnumDescriptor {
	return file_test_message_proto_enumTypes[0].Descriptor()
}

func (TestMessage_TestEnum) Type() protoreflect.EnumType {
	return &file_test_message_proto_enumTypes[0]
}

func (x TestMessage_TestEnum) Number() protoreflect.EnumNumber {
	return protoreflect.EnumNumber(x)
}

// Deprecated: Use TestMessage_TestEnum.Descriptor instead.
func (TestMessage_TestEnum) EnumDescriptor() ([]byte, []int) {
	return file_test_message_proto_rawDescGZIP(), []int{0, 0}
}

type TestMessage struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Int32Value    int32                `protobuf:"varint,1,opt,name=int32_value,json=int32Value,proto3" json:"int32_value,omitempty"`
	Int64Value    int64                `protobuf:"varint,2,opt,name=int64_value,json=int64Value,proto3" json:"int64_value,omitempty"`
	Uint32Value   uint32               `protobuf:"varint,3,opt,name=uint32_value,json=uint32Value,proto3" json:"uint32_value,omitempty"`
	Uint64Value   uint64               `protobuf:"varint,4,opt,name=uint64_value,json=uint64Value,proto3" json:"uint64_value,omitempty"`
	Sint32Value   int32                `protobuf:"zigzag32,5,opt,name=sint32_value,json=sint32Value,proto3" json:"sint32_value,omitempty"`
	Sint64Value   int64                `protobuf:"zigzag64,6,opt,name=sint64_value,json=sint64Value,proto3" json:"sint64_value,omitempty"`
	BoolValue     bool                 `protobuf:"varint,7,opt,name=bool_value,json=boolValue,proto3" json:"bool_value,omitempty"`
	EnumValue     TestMessage_TestEnum `protobuf:"varint,8,opt,name=enum_value,json=enumValue,proto3,enum=strims.test.TestMessage_TestEnum" json:"enum_value,omitempty"`
	Fixed64Value  uint64               `protobuf:"fixed64,9,opt,name=fixed64_value,json=fixed64Value,proto3" json:"fixed64_value,omitempty"`
	Sfixed64Value int64                `protobuf:"fixed64,10,opt,name=sfixed64_value,json=sfixed64Value,proto3" json:"sfixed64_value,omitempty"`
	DoubleValue   float64              `protobuf:"fixed64,11,opt,name=double_value,json=doubleValue,proto3" json:"double_value,omitempty"`
	StringValue   string               `protobuf:"bytes,12,opt,name=string_value,json=stringValue,proto3" json:"string_value,omitempty"`
	BytesValue    []byte               `protobuf:"bytes,13,opt,name=bytes_value,json=bytesValue,proto3" json:"bytes_value,omitempty"`
	Fixed32Value  uint32               `protobuf:"fixed32,14,opt,name=fixed32_value,json=fixed32Value,proto3" json:"fixed32_value,omitempty"`
	SfixedValue   int32                `protobuf:"fixed32,15,opt,name=sfixed_value,json=sfixedValue,proto3" json:"sfixed_value,omitempty"`
	FloatValue    float32              `protobuf:"fixed32,16,opt,name=float_value,json=floatValue,proto3" json:"float_value,omitempty"`
}

func (x *TestMessage) Reset() {
	*x = TestMessage{}
	if protoimpl.UnsafeEnabled {
		mi := &file_test_message_proto_msgTypes[0]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *TestMessage) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*TestMessage) ProtoMessage() {}

func (x *TestMessage) ProtoReflect() protoreflect.Message {
	mi := &file_test_message_proto_msgTypes[0]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use TestMessage.ProtoReflect.Descriptor instead.
func (*TestMessage) Descriptor() ([]byte, []int) {
	return file_test_message_proto_rawDescGZIP(), []int{0}
}

func (x *TestMessage) GetInt32Value() int32 {
	if x != nil {
		return x.Int32Value
	}
	return 0
}

func (x *TestMessage) GetInt64Value() int64 {
	if x != nil {
		return x.Int64Value
	}
	return 0
}

func (x *TestMessage) GetUint32Value() uint32 {
	if x != nil {
		return x.Uint32Value
	}
	return 0
}

func (x *TestMessage) GetUint64Value() uint64 {
	if x != nil {
		return x.Uint64Value
	}
	return 0
}

func (x *TestMessage) GetSint32Value() int32 {
	if x != nil {
		return x.Sint32Value
	}
	return 0
}

func (x *TestMessage) GetSint64Value() int64 {
	if x != nil {
		return x.Sint64Value
	}
	return 0
}

func (x *TestMessage) GetBoolValue() bool {
	if x != nil {
		return x.BoolValue
	}
	return false
}

func (x *TestMessage) GetEnumValue() TestMessage_TestEnum {
	if x != nil {
		return x.EnumValue
	}
	return TestMessage_TEST_ENUM_VAL_0
}

func (x *TestMessage) GetFixed64Value() uint64 {
	if x != nil {
		return x.Fixed64Value
	}
	return 0
}

func (x *TestMessage) GetSfixed64Value() int64 {
	if x != nil {
		return x.Sfixed64Value
	}
	return 0
}

func (x *TestMessage) GetDoubleValue() float64 {
	if x != nil {
		return x.DoubleValue
	}
	return 0
}

func (x *TestMessage) GetStringValue() string {
	if x != nil {
		return x.StringValue
	}
	return ""
}

func (x *TestMessage) GetBytesValue() []byte {
	if x != nil {
		return x.BytesValue
	}
	return nil
}

func (x *TestMessage) GetFixed32Value() uint32 {
	if x != nil {
		return x.Fixed32Value
	}
	return 0
}

func (x *TestMessage) GetSfixedValue() int32 {
	if x != nil {
		return x.SfixedValue
	}
	return 0
}

func (x *TestMessage) GetFloatValue() float32 {
	if x != nil {
		return x.FloatValue
	}
	return 0
}

var File_test_message_proto protoreflect.FileDescriptor

var file_test_message_proto_rawDesc = []byte{
	0x0a, 0x12, 0x74, 0x65, 0x73, 0x74, 0x2f, 0x6d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x2e, 0x70,
	0x72, 0x6f, 0x74, 0x6f, 0x12, 0x0b, 0x73, 0x74, 0x72, 0x69, 0x6d, 0x73, 0x2e, 0x74, 0x65, 0x73,
	0x74, 0x22, 0xa3, 0x05, 0x0a, 0x0b, 0x54, 0x65, 0x73, 0x74, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67,
	0x65, 0x12, 0x1f, 0x0a, 0x0b, 0x69, 0x6e, 0x74, 0x33, 0x32, 0x5f, 0x76, 0x61, 0x6c, 0x75, 0x65,
	0x18, 0x01, 0x20, 0x01, 0x28, 0x05, 0x52, 0x0a, 0x69, 0x6e, 0x74, 0x33, 0x32, 0x56, 0x61, 0x6c,
	0x75, 0x65, 0x12, 0x1f, 0x0a, 0x0b, 0x69, 0x6e, 0x74, 0x36, 0x34, 0x5f, 0x76, 0x61, 0x6c, 0x75,
	0x65, 0x18, 0x02, 0x20, 0x01, 0x28, 0x03, 0x52, 0x0a, 0x69, 0x6e, 0x74, 0x36, 0x34, 0x56, 0x61,
	0x6c, 0x75, 0x65, 0x12, 0x21, 0x0a, 0x0c, 0x75, 0x69, 0x6e, 0x74, 0x33, 0x32, 0x5f, 0x76, 0x61,
	0x6c, 0x75, 0x65, 0x18, 0x03, 0x20, 0x01, 0x28, 0x0d, 0x52, 0x0b, 0x75, 0x69, 0x6e, 0x74, 0x33,
	0x32, 0x56, 0x61, 0x6c, 0x75, 0x65, 0x12, 0x21, 0x0a, 0x0c, 0x75, 0x69, 0x6e, 0x74, 0x36, 0x34,
	0x5f, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x18, 0x04, 0x20, 0x01, 0x28, 0x04, 0x52, 0x0b, 0x75, 0x69,
	0x6e, 0x74, 0x36, 0x34, 0x56, 0x61, 0x6c, 0x75, 0x65, 0x12, 0x21, 0x0a, 0x0c, 0x73, 0x69, 0x6e,
	0x74, 0x33, 0x32, 0x5f, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x18, 0x05, 0x20, 0x01, 0x28, 0x11, 0x52,
	0x0b, 0x73, 0x69, 0x6e, 0x74, 0x33, 0x32, 0x56, 0x61, 0x6c, 0x75, 0x65, 0x12, 0x21, 0x0a, 0x0c,
	0x73, 0x69, 0x6e, 0x74, 0x36, 0x34, 0x5f, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x18, 0x06, 0x20, 0x01,
	0x28, 0x12, 0x52, 0x0b, 0x73, 0x69, 0x6e, 0x74, 0x36, 0x34, 0x56, 0x61, 0x6c, 0x75, 0x65, 0x12,
	0x1d, 0x0a, 0x0a, 0x62, 0x6f, 0x6f, 0x6c, 0x5f, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x18, 0x07, 0x20,
	0x01, 0x28, 0x08, 0x52, 0x09, 0x62, 0x6f, 0x6f, 0x6c, 0x56, 0x61, 0x6c, 0x75, 0x65, 0x12, 0x40,
	0x0a, 0x0a, 0x65, 0x6e, 0x75, 0x6d, 0x5f, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x18, 0x08, 0x20, 0x01,
	0x28, 0x0e, 0x32, 0x21, 0x2e, 0x73, 0x74, 0x72, 0x69, 0x6d, 0x73, 0x2e, 0x74, 0x65, 0x73, 0x74,
	0x2e, 0x54, 0x65, 0x73, 0x74, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x2e, 0x54, 0x65, 0x73,
	0x74, 0x45, 0x6e, 0x75, 0x6d, 0x52, 0x09, 0x65, 0x6e, 0x75, 0x6d, 0x56, 0x61, 0x6c, 0x75, 0x65,
	0x12, 0x23, 0x0a, 0x0d, 0x66, 0x69, 0x78, 0x65, 0x64, 0x36, 0x34, 0x5f, 0x76, 0x61, 0x6c, 0x75,
	0x65, 0x18, 0x09, 0x20, 0x01, 0x28, 0x06, 0x52, 0x0c, 0x66, 0x69, 0x78, 0x65, 0x64, 0x36, 0x34,
	0x56, 0x61, 0x6c, 0x75, 0x65, 0x12, 0x25, 0x0a, 0x0e, 0x73, 0x66, 0x69, 0x78, 0x65, 0x64, 0x36,
	0x34, 0x5f, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x18, 0x0a, 0x20, 0x01, 0x28, 0x10, 0x52, 0x0d, 0x73,
	0x66, 0x69, 0x78, 0x65, 0x64, 0x36, 0x34, 0x56, 0x61, 0x6c, 0x75, 0x65, 0x12, 0x21, 0x0a, 0x0c,
	0x64, 0x6f, 0x75, 0x62, 0x6c, 0x65, 0x5f, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x18, 0x0b, 0x20, 0x01,
	0x28, 0x01, 0x52, 0x0b, 0x64, 0x6f, 0x75, 0x62, 0x6c, 0x65, 0x56, 0x61, 0x6c, 0x75, 0x65, 0x12,
	0x21, 0x0a, 0x0c, 0x73, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x5f, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x18,
	0x0c, 0x20, 0x01, 0x28, 0x09, 0x52, 0x0b, 0x73, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x56, 0x61, 0x6c,
	0x75, 0x65, 0x12, 0x1f, 0x0a, 0x0b, 0x62, 0x79, 0x74, 0x65, 0x73, 0x5f, 0x76, 0x61, 0x6c, 0x75,
	0x65, 0x18, 0x0d, 0x20, 0x01, 0x28, 0x0c, 0x52, 0x0a, 0x62, 0x79, 0x74, 0x65, 0x73, 0x56, 0x61,
	0x6c, 0x75, 0x65, 0x12, 0x23, 0x0a, 0x0d, 0x66, 0x69, 0x78, 0x65, 0x64, 0x33, 0x32, 0x5f, 0x76,
	0x61, 0x6c, 0x75, 0x65, 0x18, 0x0e, 0x20, 0x01, 0x28, 0x07, 0x52, 0x0c, 0x66, 0x69, 0x78, 0x65,
	0x64, 0x33, 0x32, 0x56, 0x61, 0x6c, 0x75, 0x65, 0x12, 0x21, 0x0a, 0x0c, 0x73, 0x66, 0x69, 0x78,
	0x65, 0x64, 0x5f, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x18, 0x0f, 0x20, 0x01, 0x28, 0x0f, 0x52, 0x0b,
	0x73, 0x66, 0x69, 0x78, 0x65, 0x64, 0x56, 0x61, 0x6c, 0x75, 0x65, 0x12, 0x1f, 0x0a, 0x0b, 0x66,
	0x6c, 0x6f, 0x61, 0x74, 0x5f, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x18, 0x10, 0x20, 0x01, 0x28, 0x02,
	0x52, 0x0a, 0x66, 0x6c, 0x6f, 0x61, 0x74, 0x56, 0x61, 0x6c, 0x75, 0x65, 0x22, 0x49, 0x0a, 0x08,
	0x54, 0x65, 0x73, 0x74, 0x45, 0x6e, 0x75, 0x6d, 0x12, 0x13, 0x0a, 0x0f, 0x54, 0x45, 0x53, 0x54,
	0x5f, 0x45, 0x4e, 0x55, 0x4d, 0x5f, 0x56, 0x41, 0x4c, 0x5f, 0x30, 0x10, 0x00, 0x12, 0x13, 0x0a,
	0x0f, 0x54, 0x45, 0x53, 0x54, 0x5f, 0x45, 0x4e, 0x55, 0x4d, 0x5f, 0x56, 0x41, 0x4c, 0x5f, 0x31,
	0x10, 0x01, 0x12, 0x13, 0x0a, 0x0f, 0x54, 0x45, 0x53, 0x54, 0x5f, 0x45, 0x4e, 0x55, 0x4d, 0x5f,
	0x56, 0x41, 0x4c, 0x5f, 0x32, 0x10, 0x02, 0x42, 0x53, 0x0a, 0x1a, 0x6f, 0x72, 0x67, 0x2e, 0x6d,
	0x65, 0x6d, 0x65, 0x6c, 0x61, 0x62, 0x73, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x62, 0x75, 0x66,
	0x2e, 0x74, 0x65, 0x73, 0x74, 0x5a, 0x2f, 0x67, 0x69, 0x74, 0x68, 0x75, 0x62, 0x2e, 0x63, 0x6f,
	0x6d, 0x2f, 0x4d, 0x65, 0x6d, 0x65, 0x4c, 0x61, 0x62, 0x73, 0x2f, 0x70, 0x72, 0x6f, 0x74, 0x6f,
	0x62, 0x75, 0x66, 0x2f, 0x70, 0x6b, 0x67, 0x2f, 0x61, 0x70, 0x69, 0x73, 0x2f, 0x74, 0x65, 0x73,
	0x74, 0x3b, 0x74, 0x65, 0x73, 0x74, 0xba, 0x02, 0x03, 0x53, 0x54, 0x4d, 0x62, 0x06, 0x70, 0x72,
	0x6f, 0x74, 0x6f, 0x33,
}

var (
	file_test_message_proto_rawDescOnce sync.Once
	file_test_message_proto_rawDescData = file_test_message_proto_rawDesc
)

func file_test_message_proto_rawDescGZIP() []byte {
	file_test_message_proto_rawDescOnce.Do(func() {
		file_test_message_proto_rawDescData = protoimpl.X.CompressGZIP(file_test_message_proto_rawDescData)
	})
	return file_test_message_proto_rawDescData
}

var file_test_message_proto_enumTypes = make([]protoimpl.EnumInfo, 1)
var file_test_message_proto_msgTypes = make([]protoimpl.MessageInfo, 1)
var file_test_message_proto_goTypes = []interface{}{
	(TestMessage_TestEnum)(0), // 0: strims.test.TestMessage.TestEnum
	(*TestMessage)(nil),       // 1: strims.test.TestMessage
}
var file_test_message_proto_depIdxs = []int32{
	0, // 0: strims.test.TestMessage.enum_value:type_name -> strims.test.TestMessage.TestEnum
	1, // [1:1] is the sub-list for method output_type
	1, // [1:1] is the sub-list for method input_type
	1, // [1:1] is the sub-list for extension type_name
	1, // [1:1] is the sub-list for extension extendee
	0, // [0:1] is the sub-list for field type_name
}

func init() { file_test_message_proto_init() }
func file_test_message_proto_init() {
	if File_test_message_proto != nil {
		return
	}
	if !protoimpl.UnsafeEnabled {
		file_test_message_proto_msgTypes[0].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*TestMessage); i {
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
			RawDescriptor: file_test_message_proto_rawDesc,
			NumEnums:      1,
			NumMessages:   1,
			NumExtensions: 0,
			NumServices:   0,
		},
		GoTypes:           file_test_message_proto_goTypes,
		DependencyIndexes: file_test_message_proto_depIdxs,
		EnumInfos:         file_test_message_proto_enumTypes,
		MessageInfos:      file_test_message_proto_msgTypes,
	}.Build()
	File_test_message_proto = out.File
	file_test_message_proto_rawDesc = nil
	file_test_message_proto_goTypes = nil
	file_test_message_proto_depIdxs = nil
}
