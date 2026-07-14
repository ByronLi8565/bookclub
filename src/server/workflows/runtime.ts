import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { currentIdentity } from "../auth/cookies.ts";
import type { Env } from "../env.ts";
import type { Identity } from "../state/GroupAgent.ts";
import type { GroupFailureReason } from "../../shared/types/groups.ts";

export const WorkflowError = {
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
} as const;

export type WorkflowError = (typeof WorkflowError)[keyof typeof WorkflowError] | GroupFailureReason;

export const WorkflowReason = { Empty: "empty", TooLong: "too_long" } as const;

export type WorkflowReason = (typeof WorkflowReason)[keyof typeof WorkflowReason];

const WorkflowErrorSchema = Schema.Union([
  Schema.Literal(WorkflowError.InternalError),
  Schema.Literal(WorkflowError.Unauthenticated),
  Schema.Literal(WorkflowError.InvalidRequest),
  Schema.Literal(WorkflowError.InvalidName),
  Schema.Literal(WorkflowError.InvalidEmail),
  Schema.Literal(WorkflowError.IdExhausted),
  Schema.Literal(WorkflowError.UnsupportedType),
  Schema.Literal(WorkflowError.NoBook),
  Schema.Literal(WorkflowError.KindMismatch),
  Schema.Literal(WorkflowError.TooLarge),
  Schema.Literal(WorkflowError.InvalidBackup),
  Schema.Literal(WorkflowError.BackupClubMismatch),
  Schema.Literal("exists"),
  Schema.Literal("not_member"),
  Schema.Literal("not_found"),
  Schema.Literal("forbidden"),
  Schema.Literal("bad_source"),
  Schema.Literal("empty"),
  Schema.Literal("bad_invite"),
  Schema.Literal("wrong_email"),
  Schema.Literal("bad_member"),
]);

const WorkflowReasonSchema = Schema.Union([
  Schema.Literal(WorkflowReason.Empty),
  Schema.Literal(WorkflowReason.TooLong),
]);

export type WorkflowResult<T> = { ok: true; value: T } | WorkflowFailure;

export interface WorkflowFailure {
  ok: false;
  status: number;
  error: WorkflowError;
  reason?: WorkflowReason;
}

export class WorkflowFailureError extends Schema.TaggedErrorClass<WorkflowFailureError>()(
  "Workflow.Failure",
  {
    status: Schema.Number,
    error: WorkflowErrorSchema,
    reason: Schema.optionalKey(WorkflowReasonSchema),
  },
) {}

export type WorkflowEffect<T> = Effect.Effect<T, WorkflowFailureError>;

export function fail(
  status: number,
  error: WorkflowError,
  reason?: WorkflowReason,
): WorkflowFailureError {
  return new WorkflowFailureError(
    reason === undefined ? { status, error } : { status, error, reason },
  );
}

const succeed = <T>(value: T): WorkflowResult<T> => ({ ok: true, value });

// Wraps an async agent/IO call. A rejection becomes a typed `WorkflowFailure`
// (HTTP 500) in the error channel rather than an unrecoverable defect: with the
// old `Effect.promise`, any thrown/rejected step escaped `runWorkflow`'s match
// and crashed the request instead of surfacing a structured error the client
// can turn into a toast. Never fail silently.
export const tryPromise = Effect.fn("Workflow.tryPromise")(function* <T>(
  evaluate: () => T,
): Effect.fn.Return<Awaited<T>, WorkflowFailureError> {
  return yield* Effect.tryPromise({
    try: () => Promise.resolve(evaluate()),
    catch: (cause) => {
      console.error("workflow step failed", cause);
      return fail(500, WorkflowError.InternalError);
    },
  });
});

export const runWorkflow = <T>(
  operation: string,
  workflow: WorkflowEffect<T>,
): Promise<WorkflowResult<T>> =>
  Effect.runPromise(
    workflow.pipe(
      Effect.withSpan(operation),
      Effect.match({
        onFailure: ({ status, error, reason }): WorkflowFailure =>
          reason === undefined
            ? { ok: false, status, error }
            : { ok: false, status, error, reason },
        onSuccess: succeed,
      }),
    ),
  );

export const requireIdentity = Effect.fn("Workflow.requireIdentity")(function* (
  env: Env,
  request: Request,
): Effect.fn.Return<Identity, WorkflowFailureError> {
  const me = yield* tryPromise(() => currentIdentity(request, env));
  if (!me) return yield* Effect.fail(fail(401, WorkflowError.Unauthenticated));
  return me;
});
