import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export function decode<S extends Schema.Decoder<unknown>>(
  schema: S,
  value: unknown,
): S["Type"] | null {
  return Option.getOrNull(Schema.decodeUnknownOption(schema)(value));
}
