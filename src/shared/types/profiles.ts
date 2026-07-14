import * as Schema from "effect/Schema";

type SchemaType<S extends Schema.Top> = S["Type"];

export const MAX_DISPLAY_NAME_LENGTH = 80;

export const ClubProfile = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  avatarImageId: Schema.optionalKey(Schema.String),
});

export interface ClubProfile extends SchemaType<typeof ClubProfile> {}
