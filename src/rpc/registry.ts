import { Any } from "../apis/google/protobuf/any";
import { MessageClass } from "../pb/message";

// maintains a mapping of type names to classes that survives minification to
// allow encoding and decoding Any fields.

const messageTypes: Map<string, MessageClass<unknown>> = new Map<string, MessageClass<unknown>>();
const messageTypeNames: Map<MessageClass<unknown>, string> = new Map<
  MessageClass<unknown>,
  string
>();

export const registerType = (name: string, type: MessageClass<unknown>): void => {
  messageTypes.set(name, type);
  messageTypeNames.set(type, name);
};

export const anyValueType = (msg: Any): MessageClass<unknown> => {
  const nameIndex = msg.typeUrl.lastIndexOf("/") + 1;
  return messageTypes.get(msg.typeUrl.substr(nameIndex));
};

export const typeName = (type: MessageClass<unknown>): string => {
  return messageTypeNames.get(type);
};
