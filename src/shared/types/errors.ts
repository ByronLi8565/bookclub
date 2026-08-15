import * as Schema from "effect/Schema";
import { GroupFailureReason } from "./groups.ts";

export const ApiError = {
  InternalError: "internal_error",
  Unauthenticated: "unauthenticated",
  InvalidRequest: "invalid_request",
  InvalidName: "invalid_name",
  InvalidEmail: "invalid_email",
  IdExhausted: "id_exhausted",
  UnsupportedType: "unsupported_type",
  NoBook: "no_book",
  KindMismatch: "kind_mismatch",
  TooLarge: "too_large",
  InvalidBackup: "invalid_backup",
  BackupClubMismatch: "backup_club_mismatch",
  MissingKey: "missing_key",
  RestoreFailed: "restore_failed",
  RateLimited: "rate_limited",
  NoPending: "no_pending",
  Expired: "expired",
  TooManyAttempts: "too_many_attempts",
  BadCode: "bad_code",
  NoPassword: "no_password",
  BadPassword: "bad_password",
  NoUser: "no_user",
  BadCurrent: "bad_current",
  WeakPassword: "weak_password",
  ChallengeExpired: "challenge_expired",
  VerificationFailed: "verification_failed",
  NoPasskeys: "no_passkeys",
  UnknownCredential: "unknown_credential",
} as const;

export type ApiError = (typeof ApiError)[keyof typeof ApiError] | GroupFailureReason;

export const ApiErrorReason = { Empty: "empty", TooLong: "too_long" } as const;

export type ApiErrorReason = string;

export const ApiErrorSchema = Schema.Union([
  ...Object.values(ApiError).map(Schema.Literal),
  ...Object.values(GroupFailureReason).map(Schema.Literal),
]);

export const ApiErrorReasonSchema = Schema.String;

export const ApiErrorBody = Schema.Struct({
  error: ApiErrorSchema,
  reason: Schema.optionalKey(ApiErrorReasonSchema),
});

export interface ApiErrorBody extends Schema.Schema.Type<typeof ApiErrorBody> {}
