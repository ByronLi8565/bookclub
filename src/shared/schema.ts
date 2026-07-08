import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export function decode<S extends Schema.Top>(
  schema: S,
  value: unknown,
): Schema.Schema.Type<S> | null {
  return Option.getOrNull(
    Schema.decodeUnknownOption(schema as unknown as Schema.Decoder<unknown>)(value),
  ) as Schema.Schema.Type<S> | null;
}
