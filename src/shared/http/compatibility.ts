import { Schema } from "effect";
import { HttpApiSchema } from "effect/unstable/httpapi";

export const PublicUser = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  avatarImageId: Schema.optionalKey(Schema.String),
});

export const Session = Schema.Struct({ user: PublicUser, token: Schema.String });
export const JsonObject = Schema.Record(Schema.String, Schema.Unknown);

export const Created = <S extends Schema.Top>(schema: S) => schema.pipe(HttpApiSchema.status(201));

export const Bytes = Schema.Uint8Array.pipe(
  HttpApiSchema.asUint8Array({ contentType: "application/octet-stream" }),
);

export const StreamBytes = HttpApiSchema.StreamUint8Array({
  contentType: "application/octet-stream",
});
