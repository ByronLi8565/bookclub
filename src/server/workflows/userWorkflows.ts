import { getAgentByName } from "agents";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  SetReadingPositionRequest,
  type StoredReadingPosition,
} from "../../shared/types/readingPositions.ts";
import { SetUserPrefsRequest, type UserPrefs } from "../../shared/types/userPrefs.ts";
import { currentIdentity } from "../auth/cookies.ts";
import type { Env } from "../env.ts";
import type { GroupAgent, Identity } from "../agents/GroupAgent.ts";
import type { AuthAgent } from "../agents/AuthAgent.ts";

export type WorkflowResult<T> = { ok: true; value: T } | WorkflowFailure;

export interface WorkflowFailure {
  ok: false;
  status: number;
  error: string;
}

type Async<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : T[K];
};
type Auth = Async<AuthAgent>;
type Group = Async<GroupAgent>;

function fail(status: number, error: string): WorkflowFailure {
  return { ok: false, status, error };
}

const succeed = <T>(value: T): WorkflowResult<T> => ({ ok: true, value });

const tryPromise = <T>(evaluate: () => T | PromiseLike<T>): Effect.Effect<Awaited<T>> =>
  Effect.promise(() => Promise.resolve(evaluate()));

const runWorkflow = <T>(workflow: Effect.Effect<T, WorkflowFailure>): Promise<WorkflowResult<T>> =>
  Effect.runPromise(
    workflow.pipe(Effect.match({ onFailure: (failure) => failure, onSuccess: succeed })),
  );

const requireIdentity = (env: Env, request: Request): Effect.Effect<Identity, WorkflowFailure> =>
  Effect.gen(function* () {
    const me = yield* tryPromise(() => currentIdentity(request, env));
    if (!me) return yield* Effect.fail(fail(401, "unauthenticated"));
    return me;
  });

const authFor = (env: Env, me: Identity): Effect.Effect<Auth> =>
  Effect.map(
    tryPromise(() => getAgentByName(env.AuthAgent, me.email)),
    (auth) => auth as unknown as Auth,
  );

const requireSource = (
  env: Env,
  me: Identity,
  groupId: string,
  sourceId: string,
): Effect.Effect<{ kind: "epub" | "pdf" }, WorkflowFailure> =>
  Effect.gen(function* () {
    const group = (yield* tryPromise(() =>
      getAgentByName(env.GroupAgent, groupId),
    )) as unknown as Group;
    const membership = yield* tryPromise(() => group.membership(me.id));
    if (!membership.isMember) return yield* Effect.fail(fail(403, "not_member"));
    const summary = yield* tryPromise(() => group.getSummary());
    const meta = summary?.sourceMeta[sourceId];
    if (!summary || !summary.sources.includes(sourceId) || !meta) {
      return yield* Effect.fail(fail(404, "bad_source"));
    }
    return { kind: meta.kind };
  });

function decode<S extends Schema.Top>(schema: S, value: unknown): Schema.Schema.Type<S> | null {
  try {
    return Schema.decodeUnknownSync(schema as unknown as Schema.Decoder<unknown, never>)(
      value,
    ) as Schema.Schema.Type<S>;
  } catch {
    return null;
  }
}

export function getUserPrefs(
  env: Env,
  request: Request,
): Promise<WorkflowResult<{ prefs: UserPrefs }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const auth = yield* authFor(env, me);
      return { prefs: yield* tryPromise(() => auth.getPrefs()) };
    }),
  );
}

export function setUserPrefs(
  env: Env,
  request: Request,
  body: unknown,
): Promise<WorkflowResult<{ prefs: UserPrefs }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const decoded = decode(SetUserPrefsRequest, body);
      if (!decoded) return yield* Effect.fail(fail(400, "invalid_request"));
      const me = yield* requireIdentity(env, request);
      const auth = yield* authFor(env, me);
      return { prefs: yield* tryPromise(() => auth.setPrefs(decoded.prefs)) };
    }),
  );
}

export function getReadingPosition(
  env: Env,
  request: Request,
  groupId: string | null,
  sourceId: string | null,
): Promise<WorkflowResult<{ position: StoredReadingPosition | null }>> {
  return runWorkflow(
    Effect.gen(function* () {
      if (!groupId || !sourceId) return yield* Effect.fail(fail(400, "invalid_request"));
      const me = yield* requireIdentity(env, request);
      yield* requireSource(env, me, groupId, sourceId);
      const auth = yield* authFor(env, me);
      return { position: yield* tryPromise(() => auth.getReadingPosition(groupId, sourceId)) };
    }),
  );
}

export function setReadingPosition(
  env: Env,
  request: Request,
  body: unknown,
): Promise<WorkflowResult<{ position: StoredReadingPosition }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const decoded = decode(SetReadingPositionRequest, body);
      if (!decoded) return yield* Effect.fail(fail(400, "invalid_request"));
      const { position } = decoded;
      if (position.groupId !== decoded.groupId || position.sourceId !== decoded.sourceId) {
        return yield* Effect.fail(fail(400, "invalid_request"));
      }
      const me = yield* requireIdentity(env, request);
      const source = yield* requireSource(env, me, position.groupId, position.sourceId);
      if (source.kind !== position.kind) return yield* Effect.fail(fail(400, "kind_mismatch"));
      const auth = yield* authFor(env, me);
      return { position: yield* tryPromise(() => auth.setReadingPosition(position)) };
    }),
  );
}
