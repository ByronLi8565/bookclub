import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const JsonObject = Schema.Record(Schema.String, Schema.Unknown);

export async function readJson(request: Request) {
  try {
    return Option.getOrNull(Schema.decodeUnknownOption(JsonObject)(await request.json()));
  } catch {
    return null;
  }
}
