import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import { SourceKind } from "./sources.ts";

type SchemaType<S extends Schema.Top> = S["Type"];

export const GroupRole = {
  Owner: "owner",
  Admin: "admin",
  Member: "member",
  Visitor: "visitor",
} as const;

export type GroupRole = (typeof GroupRole)[keyof typeof GroupRole];

export const GroupRoleSchema = Schema.Union([
  Schema.Literal(GroupRole.Owner),
  Schema.Literal(GroupRole.Admin),
  Schema.Literal(GroupRole.Member),
  Schema.Literal(GroupRole.Visitor),
]);

export const GroupFailureReason = {
  Exists: "exists",
  NotMember: "not_member",
  NotFound: "not_found",
  Forbidden: "forbidden",
  BadSource: "bad_source",
  Empty: "empty",
  BadInvite: "bad_invite",
  WrongEmail: "wrong_email",
  BadMember: "bad_member",
} as const;

export type GroupFailureReason = (typeof GroupFailureReason)[keyof typeof GroupFailureReason];

export const SourceMeta = Schema.Struct({
  kind: SourceKind,
  contentType: Schema.String,
  size: Schema.Number,
  title: Schema.optionalKey(Schema.NullOr(Schema.String)),
  author: Schema.optionalKey(Schema.NullOr(Schema.String)),
  wordCount: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  addedBy: Schema.String,
});

export interface SourceMeta extends SchemaType<typeof SourceMeta> {}

const MAX_AUTHOR_LENGTH = 200;

/** A cleared author is `null`; a present one is trimmed and bounded. Parsed on
 *  the server only, so the client sends what the reader typed. */
const Author = Schema.NullOr(Schema.String).pipe(
  Schema.decode({
    decode: SchemaGetter.transform((raw: string | null) =>
      raw === null ? null : raw.trim().slice(0, MAX_AUTHOR_LENGTH) || null,
    ),
    encode: SchemaGetter.passthrough(),
  }),
);

export const BookMetadataPatchSchema = Schema.Struct({
  author: Schema.optionalKey(Author),
  wordCount: Schema.optionalKey(Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))),
}).check(
  Schema.makeFilter((patch) => "author" in patch || "wordCount" in patch, {
    message: "a metadata patch changes at least one field",
  }),
);

export interface BookMetadataPatch extends SchemaType<typeof BookMetadataPatchSchema> {}

export const GroupSummary = Schema.Struct({
  groupId: Schema.String,
  slug: Schema.String,
  publicId: Schema.String,
  displayName: Schema.String,
  ownerId: Schema.String,
  sources: Schema.mutable(Schema.Array(Schema.String)),
  bookTitles: Schema.Record(Schema.String, Schema.String),
  sourceMeta: Schema.Record(Schema.String, SourceMeta),
  memberCount: Schema.Number,
});

export interface GroupSummary extends SchemaType<typeof GroupSummary> {}

export const Membership = Schema.Struct({
  isMember: Schema.Boolean,
  role: Schema.NullOr(GroupRoleSchema),
});

export interface Membership extends SchemaType<typeof Membership> {}

export const RosterEntry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  role: GroupRoleSchema,
  avatarImageId: Schema.optionalKey(Schema.String),
});

export interface RosterEntry extends SchemaType<typeof RosterEntry> {}
