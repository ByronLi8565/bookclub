import * as Effect from "effect/Effect";
import { currentIdentity } from "../auth/cookies.ts";
import type { Env } from "../env.ts";
import type { Identity } from "../agents/GroupAgent.ts";

export type WorkflowResult<T> = { ok: true; value: T } | WorkflowFailure;

export interface WorkflowFailure {
  ok: false;
  status: number;
  error: string;
  reason?: string;
}

export type WorkflowEffect<T> = Effect.Effect<T, WorkflowFailure>;

/** Maps an agent's sync/async method surface to an all-async stub-call shape. */
export type Async<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : T[K];
};

export function fail(status: number, error: string, reason?: string): WorkflowFailure {
  return reason === undefined ? { ok: false, status, error } : { ok: false, status, error, reason };
}

const succeed = <T>(value: T): WorkflowResult<T> => ({ ok: true, value });

export const tryPromise = <T>(evaluate: () => T | PromiseLike<T>): Effect.Effect<Awaited<T>> =>
  Effect.promise(() => Promise.resolve(evaluate()));

export const runWorkflow = <T>(workflow: WorkflowEffect<T>): Promise<WorkflowResult<T>> =>
  Effect.runPromise(
    workflow.pipe(Effect.match({ onFailure: (failure) => failure, onSuccess: succeed })),
  );

export const requireIdentity = (env: Env, request: Request): WorkflowEffect<Identity> =>
  Effect.gen(function* () {
    const me = yield* tryPromise(() => currentIdentity(request, env));
    if (!me) return yield* Effect.fail(fail(401, "unauthenticated"));
    return me;
  });
