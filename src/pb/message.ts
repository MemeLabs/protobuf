import Reader from "./reader";
import Writer from "./writer";

export type MessageClass<T> = {
  encode(m: T, w?: Writer): Writer;
  decode(r: Reader | Uint8Array, length?: number): T;
};

export type Message<T> = {
  constructor: MessageClass<T>;
};
