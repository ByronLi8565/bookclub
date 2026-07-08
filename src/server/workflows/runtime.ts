import * as Effect from "effect/Effect";
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
} as const;

export type WorkflowError = (typeof WorkflowError)[keyof typeof WorkflowError] | GroupFailureReason;

export const WorkflowReason = { Empty: "empty", TooLong: "too_long" } as const;

export type WorkflowReason = (typeof WorkflowReason)[keyof typeof WorkflowReason];

export type WorkflowResult<T> = { ok: true; value: T } | WorkflowFailure;

export interface WorkflowFailure {
  ok: false;
  status: number;
  error: WorkflowError;
  reason?: WorkflowReason;
}

export type WorkflowEffect<T> = Effect.Effect<T, WorkflowFailure>;

/** Maps an agent's sync/async method surface to an all-async stub-call shape. */
export type Async<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : T[K];
};

export function fail(
  status: number,
  error: WorkflowError,
  reason?: WorkflowReason,
): WorkflowFailure {
  return reason === undefined ? { ok: false, status, error } : { ok: false, status, error, reason };
}

const succeed = <T>(value: T): WorkflowResult<T> => ({ ok: true, value });

// Wraps an async agent/IO call. A rejection becomes a typed `WorkflowFailure`
// (HTTP 500) in the error channel rather than an unrecoverable defect: with the
// old `Effect.promise`, any thrown/rejected step escaped `runWorkflow`'s match
// and crashed the request instead of surfacing a structured error the client
// can turn into a toast. Never fail silently.
export const tryPromise = <T>(evaluate: () => T | PromiseLike<T>): WorkflowEffect<Awaited<T>> =>
  Effect.tryPromise({
    try: () => Promise.resolve(evaluate()),
    catch: (cause) => {
      console.error("workflow step failed", cause);
      return fail(500, WorkflowError.InternalError);
    },
  });

export const runWorkflow = <T>(workflow: WorkflowEffect<T>): Promise<WorkflowResult<T>> =>
  Effect.runPromise(
    workflow.pipe(Effect.match({ onFailure: (failure) => failure, onSuccess: succeed })),
  );

export const requireIdentity = (env: Env, request: Request): WorkflowEffect<Identity> =>
  Effect.gen(function* () {
    const me = yield* tryPromise(() => currentIdentity(request, env));
    if (!me) return yield* Effect.fail(fail(401, WorkflowError.Unauthenticated));
    return me;
  });
