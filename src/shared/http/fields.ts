import { Effect, Schema, SchemaGetter, SchemaIssue } from "effect";
import { normalizeEmail } from "../email.ts";
import { MAX_DISPLAY_NAME_LENGTH } from "../types/profiles.ts";
import { type ApiFailure, BadRequest, NotFound } from "./errors.ts";

/**
 * The issue annotation naming the failure a field's parse answers with, so a
 * malformed value keeps the exact status and `error` code its endpoint has
 * always documented instead of collapsing into a bare 400.
 */
export const FAILURE_ANNOTATION = "bookclub/failure";

export const MAX_GROUP_TITLE_LENGTH = 100;
const MIN_PASSWORD_LENGTH = 8;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

/**
 * A string parsed on the server alone. Encoding is the identity, so a
 * generated client sends exactly what the reader typed and the server answers
 * with the specific wire code rather than the client failing locally.
 */
const parsedString = (parse: (raw: string) => string | ApiFailure) =>
  Schema.String.pipe(
    Schema.decode({
      decode: SchemaGetter.transformOrFail((raw: string) => {
        const parsed = parse(raw);
        return typeof parsed === "string"
          ? Effect.succeed(parsed)
          : Effect.fail(new SchemaIssue.InvalidValue({ [FAILURE_ANNOTATION]: parsed }, raw));
      }),
      encode: SchemaGetter.passthrough(),
    }),
  );

/** Canonical (trimmed, lowercased) email. */
export const emailField = (failure: ApiFailure = new BadRequest({ error: "invalid_email" })) =>
  parsedString((raw) => normalizeEmail(raw) ?? failure);

export const Email = emailField();

/** A value the caller must supply, compared verbatim (a password is never trimmed). */
export const Required = parsedString((raw) =>
  raw === "" ? new BadRequest({ error: "invalid_request" }) : raw,
);

export const LoginCode = parsedString(
  (raw) => raw.trim() || new BadRequest({ error: "invalid_request" }),
);

export const NewPassword = parsedString((raw) =>
  raw.length < MIN_PASSWORD_LENGTH ? new BadRequest({ error: "weak_password" }) : raw,
);

/** A new club's name is refused rather than cut when too long, so the reader can fix it. */
export const ClubName = parsedString((raw) => {
  const name = raw.trim();
  if (name === "") return new BadRequest({ error: "invalid_name", reason: "empty" });
  if (name.length > MAX_GROUP_TITLE_LENGTH) {
    return new BadRequest({ error: "invalid_name", reason: "too_long" });
  }
  return name;
});

/** Renames keep their long-standing leniency: an overlong title is cut, not refused. */
export const Title = parsedString(
  (raw) => raw.trim().slice(0, MAX_GROUP_TITLE_LENGTH) || new BadRequest({ error: "empty" }),
);

export const MemberName = parsedString(
  (raw) =>
    raw.trim().slice(0, MAX_DISPLAY_NAME_LENGTH) || new BadRequest({ error: "invalid_name" }),
);

/** Image ids are ULIDs; anything else cannot name a stored image. */
export const ImageId = parsedString((raw) =>
  ULID.test(raw) ? raw : new NotFound({ error: "not_found" }),
);

/** Header text travels percent-encoded so any Unicode title survives the ASCII header. */
export const EncodedHeaderText = parsedString((raw) => {
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return new BadRequest({ error: "invalid_request" });
  }
});
