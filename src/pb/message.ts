import Reader from "./reader";
import Writer from "./writer";

export interface MessageClass<T> {
  encode(m: T, w?: Writer): Writer;
  decode(r: Reader | Uint8Array, length?: number): T;
}

export interface Message<T> {
  constructor: MessageClass<T>;
}
