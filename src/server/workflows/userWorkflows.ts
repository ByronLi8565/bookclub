import { getAgentByName } from "agents";
import * as Effect from "effect/Effect";
import {
  SetReadingPositionRequest,
  type StoredReadingPosition,
} from "../../shared/types/readingPositions.ts";
import { SetUserPrefsRequest, type UserPrefs } from "../../shared/types/userPrefs.ts";
import { decode } from "../../shared/schema.ts";
import { getImage, storeImage, validImageId } from "../services/images.ts";
import type { Env } from "../env.ts";
import type { GroupAgent, Identity } from "../state/GroupAgent.ts";
import type { AuthAgent } from "../state/AuthAgent.ts";
import {
  fail,
  requireIdentity,
  runWorkflow,
  tryPromise,
  type Async,
  type WorkflowEffect,
  type WorkflowFailure,
  type WorkflowResult,
  WorkflowError,
} from "./runtime.ts";
import { GroupFailureReason } from "../../shared/types/groups.ts";

export type { WorkflowFailure } from "./runtime.ts";

type Auth = Async<AuthAgent>;
type Group = Async<GroupAgent>;

function avatarScope(userId: string): string {
  return `avatars/${userId}`;
}

const authFor = (env: Env, me: Identity): WorkflowEffect<Auth> =>
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
    if (!membership.isMember) {
      return yield* Effect.fail(fail(403, GroupFailureReason.NotMember));
    }
    const summary = yield* tryPromise(() => group.getSummary());
    const meta = summary?.sourceMeta[sourceId];
    if (!summary || !summary.sources.includes(sourceId) || !meta) {
      return yield* Effect.fail(fail(404, GroupFailureReason.BadSource));
    }
    return { kind: meta.kind };
  });

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
      if (!decoded) return yield* Effect.fail(fail(400, WorkflowError.InvalidRequest));
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
      if (!groupId || !sourceId) {
        return yield* Effect.fail(fail(400, WorkflowError.InvalidRequest));
      }
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
      if (!decoded) return yield* Effect.fail(fail(400, WorkflowError.InvalidRequest));
      const { position } = decoded;
      if (position.groupId !== decoded.groupId || position.sourceId !== decoded.sourceId) {
        return yield* Effect.fail(fail(400, WorkflowError.InvalidRequest));
      }
      const me = yield* requireIdentity(env, request);
      const source = yield* requireSource(env, me, position.groupId, position.sourceId);
      if (source.kind !== position.kind) {
        return yield* Effect.fail(fail(400, WorkflowError.KindMismatch));
      }
      const auth = yield* authFor(env, me);
      return { position: yield* tryPromise(() => auth.setReadingPosition(position)) };
    }),
  );
}

export function uploadAvatar(
  env: Env,
  request: Request,
): Promise<WorkflowResult<{ id: string; contentType: string; size: number }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const bytes = yield* tryPromise(() => request.arrayBuffer());
      const stored = yield* tryPromise(() =>
        storeImage(env, avatarScope(me.id), bytes, request.headers.get("Content-Type")),
      );
      if (!stored.ok) {
        const status = stored.reason === "too_large" ? 413 : 400;
        return yield* Effect.fail(fail(status, stored.reason));
      }
      const auth = yield* authFor(env, me);
      yield* tryPromise(() => auth.setAvatarImageId(stored.image.id));
      return stored.image;
    }),
  );
}

export function fetchAvatar(
  env: Env,
  request: Request,
  userId: string,
  imageId: string,
): Promise<WorkflowResult<{ object: R2ObjectBody; contentType: string }>> {
  return runWorkflow(
    Effect.gen(function* () {
      yield* requireIdentity(env, request);
      if (!validImageId(imageId)) {
        return yield* Effect.fail(fail(404, GroupFailureReason.NotFound));
      }
      const object = yield* tryPromise(() => getImage(env, avatarScope(userId), imageId));
      if (!object) return yield* Effect.fail(fail(404, GroupFailureReason.NotFound));
      return {
        object,
        contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
      };
    }),
  );
}
