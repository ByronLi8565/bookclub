import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ApiError, ApiErrorReasonSchema, ApiErrorSchema } from "../../shared/types/errors.ts";
import type { ApiErrorReason } from "../../shared/types/errors.ts";
import { currentIdentity } from "../auth/cookies.ts";
import type { Env } from "../env.ts";
import type { Identity } from "../state/GroupAgent.ts";

export type WorkflowResult<T> = { ok: true; value: T } | WorkflowFailure;

export interface WorkflowFailure {
  ok: false;
  status: number;
  error: ApiError;
  reason?: ApiErrorReason;
}

export class WorkflowFailureError extends Schema.TaggedErrorClass<WorkflowFailureError>()(
  "Workflow.Failure",
  {
    status: Schema.Number,
    error: ApiErrorSchema,
    reason: Schema.optionalKey(ApiErrorReasonSchema),
  },
) {}

export type WorkflowEffect<T> = Effect.Effect<T, WorkflowFailureError>;

export function fail(
  status: number,
  error: ApiError,
  reason?: ApiErrorReason,
): WorkflowFailureError {
  return new WorkflowFailureError(
    reason === undefined ? { status, error } : { status, error, reason },
  );
}

const succeed = <T>(value: T): WorkflowResult<T> => ({ ok: true, value });

// Keep rejected I/O in the typed channel so clients receive structured failures.
export const tryPromise = Effect.fn("Workflow.tryPromise")(function* <T>(
  evaluate: () => T,
): Effect.fn.Return<Awaited<T>, WorkflowFailureError> {
  return yield* Effect.tryPromise({
    try: () => Promise.resolve(evaluate()),
    catch: (cause) => {
      console.error("workflow step failed", cause);
      return fail(500, ApiError.InternalError);
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
  if (!me) return yield* Effect.fail(fail(401, ApiError.Unauthenticated));
  return me;
});

export const decodeRequest = Effect.fn("Workflow.decodeRequest")(function* <
  S extends Schema.Decoder<unknown>,
>(schema: S, value: unknown): Effect.fn.Return<S["Type"], WorkflowFailureError> {
  return yield* Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(() => fail(400, ApiError.InvalidRequest)),
  );
});
