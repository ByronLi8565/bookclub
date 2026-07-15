import * as Schema from "effect/Schema";

type SchemaType<S extends Schema.Top> = S["Type"];

// Client-facing view of a registered passkey. Deliberately excludes the public
// key and counter — the browser only needs to identify and label credentials.
export const PasskeyInfo = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  createdAt: Schema.String,
});

export interface PasskeyInfo extends SchemaType<typeof PasskeyInfo> {}
