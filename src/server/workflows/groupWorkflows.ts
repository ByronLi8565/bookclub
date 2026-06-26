import { getAgentByName } from "agents";
import { Effect } from "effect";
import { monotonicFactory } from "ulidx";
import { groupUrlName, publicIdFromGroupUrl } from "../../shared/groupUrls.ts";
import type { GroupSummary, Membership, RosterEntry } from "../../shared/types/groups.ts";
import { currentSource, sourceById } from "../../shared/sources.ts";
import { getSource, storeSource } from "../services/sources.ts";
import { sendInvite } from "../services/email.ts";
import type { Env } from "../env.ts";
import type {
  AddSourceResult,
  CreateResult,
  GroupAgent,
  Identity,
  InviteLinkResult,
  InviteResult,
  RedeemResult,
  RenameGroupResult,
  RenameResult,
} from "../state/GroupAgent.ts";
import { REGISTRY_ID, type GroupRegistry } from "../state/GroupRegistry.ts";
import { randomId } from "../../shared/crypto.ts";
import { normalizeEmail } from "../../shared/email.ts";
import {
  fail,
  requireIdentity,
  runWorkflow,
  tryPromise,
  type Async,
  type WorkflowEffect,
  type WorkflowFailure,
  type WorkflowResult,
} from "./runtime.ts";

export type { WorkflowFailure } from "./runtime.ts";

const MAX_GROUP_TITLE_LENGTH = 100;
const PUBLIC_ID_LENGTH = 6;
const PUBLIC_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const PUBLIC_ID_ATTEMPTS = 10;

const ulid = monotonicFactory();

type Group = Async<GroupAgent>;
type Registry = Async<GroupRegistry>;
type ResolvedGroup = { group: Group; summary: GroupSummary };

function randomPublicId(): string {
  return randomId(PUBLIC_ID_LENGTH, PUBLIC_ID_ALPHABET);
}

const registryFor = (env: Env): WorkflowEffect<Registry> =>
  Effect.map(
    tryPromise(() => getAgentByName(env.GroupRegistry, REGISTRY_ID)),
    (registry) => registry as unknown as Registry,
  );

const reservePublicId = (env: Env, groupId: string): WorkflowEffect<string> =>
  Effect.gen(function* () {
    const registry = yield* registryFor(env);
    for (let attempt = 0; attempt < PUBLIC_ID_ATTEMPTS; attempt++) {
      const publicId = randomPublicId();
      const reserved = yield* tryPromise(() => registry.reservePublicId(publicId, groupId));
      if (reserved.ok) return publicId;
    }
    return yield* Effect.fail(fail(503, "id_exhausted"));
  });

const ensurePublicUrl = (
  env: Env,
  group: Group,
  summary: GroupSummary,
): WorkflowEffect<GroupSummary> =>
  Effect.gen(function* () {
    if (summary.publicId !== "") return summary;
    const publicId = yield* reservePublicId(env, summary.groupId);
    const updated = yield* tryPromise(() => group.assignPublicUrl(publicId));
    return updated ?? summary;
  });

const resolveGroup = (env: Env, groupRef: string): WorkflowEffect<Group> =>
  Effect.gen(function* () {
    const publicId = publicIdFromGroupUrl(groupRef);
    if (!publicId) return yield* Effect.fail(fail(404, "not_found"));
    const registry = yield* registryFor(env);
    const groupId = yield* tryPromise(() => registry.resolvePublicId(publicId));
    if (!groupId) return yield* Effect.fail(fail(404, "not_found"));
    return (yield* tryPromise(() => getAgentByName(env.GroupAgent, groupId))) as unknown as Group;
  });

const requireGroup = (env: Env, groupRef: string): WorkflowEffect<ResolvedGroup> =>
  Effect.gen(function* () {
    const group = yield* resolveGroup(env, groupRef);
    const summary = yield* tryPromise(() => group.getSummary());
    if (!summary) return yield* Effect.fail(fail(404, "not_found"));
    return { group, summary };
  });

// Resolve a group and assert the caller is a member, failing 403 otherwise.
// `denyError` lets callers distinguish the wire error (e.g. "forbidden").
const requireGroupMember = (
  env: Env,
  me: Identity,
  groupRef: string,
  denyError = "not_member",
): WorkflowEffect<ResolvedGroup> =>
  Effect.gen(function* () {
    const resolved = yield* requireGroup(env, groupRef);
    const { isMember } = yield* tryPromise(() => resolved.group.membership(me.id));
    if (!isMember) return yield* Effect.fail(fail(403, denyError));
    return resolved;
  });

type FailureReason = Extract<
  | CreateResult
  | InviteResult
  | InviteLinkResult
  | RedeemResult
  | AddSourceResult
  | RenameResult
  | RenameGroupResult,
  { ok: false }
>["reason"];

const REASON_STATUS: Record<FailureReason, number> = {
  exists: 409,
  not_member: 403,
  not_found: 404,
  empty: 400,
  bad_source: 404,
  bad_invite: 403,
  wrong_email: 403,
};

const failReason = (reason: FailureReason): WorkflowFailure => fail(REASON_STATUS[reason], reason);

// Shared scaffold for the rename/resolve-title endpoints: authenticate, resolve
// the group, run the caller-supplied agent rename (which also validates its
// inputs), then map the agent result to a group summary or a failure.
const titleWorkflow = (
  env: Env,
  request: Request,
  groupId: string,
  rename: (group: Group, callerId: string) => WorkflowEffect<RenameResult | RenameGroupResult>,
): Promise<WorkflowResult<{ group: GroupSummary }>> =>
  runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const { group } = yield* requireGroup(env, groupId);
      const result = yield* rename(group, me.id);
      if (!result.ok) return yield* Effect.fail(failReason(result.reason));
      return { group: result.summary };
    }),
  );

export function listMyGroups(
  env: Env,
  request: Request,
): Promise<WorkflowResult<{ groups: GroupSummary[] }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const auth = yield* tryPromise(() => getAgentByName(env.AuthAgent, me.email));
      const groupIds = yield* tryPromise(() => auth.getGroupIds());
      const summaries = yield* Effect.forEach(
        groupIds,
        (id) =>
          Effect.gen(function* () {
            const group = (yield* tryPromise(() =>
              getAgentByName(env.GroupAgent, id),
            )) as unknown as Group;
            const summary = yield* tryPromise(() => group.getSummary());
            return summary ? yield* ensurePublicUrl(env, group, summary) : null;
          }),
        { concurrency: "unbounded" },
      );
      return { groups: summaries.filter((summary) => summary !== null) };
    }),
  );
}

export function createGroup(
  env: Env,
  request: Request,
  rawDisplayName: unknown,
): Promise<WorkflowResult<{ group: GroupSummary }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      if (typeof rawDisplayName !== "string") {
        return yield* Effect.fail(fail(400, "invalid_name", "empty"));
      }
      const displayName = rawDisplayName.trim();
      if (displayName === "") return yield* Effect.fail(fail(400, "invalid_name", "empty"));
      if (displayName.length > MAX_GROUP_TITLE_LENGTH) {
        return yield* Effect.fail(fail(400, "invalid_name", "too_long"));
      }
      const groupId = ulid();
      const publicId = yield* reservePublicId(env, groupId);
      const group = (yield* tryPromise(() =>
        getAgentByName(env.GroupAgent, groupId),
      )) as unknown as Group;
      const result = yield* tryPromise(() => group.create(displayName, publicId, me));
      if (!result.ok) return yield* Effect.fail(failReason(result.reason));
      return { group: result.summary };
    }),
  );
}

export function resolveGroupView(
  env: Env,
  request: Request,
  groupId: string,
): Promise<
  WorkflowResult<{ group: GroupSummary; membership: Membership; members: RosterEntry[] }>
> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const { group, summary } = yield* requireGroup(env, groupId);
      const membership = yield* tryPromise(() => group.membership(me.id));
      // Self-heal the caller's club index if it drifted out of sync (e.g. a
      // club created while their AuthAgent record was missing).
      if (membership.isMember) yield* tryPromise(() => group.reindexMember(me));
      const members = membership.isMember ? yield* tryPromise(() => group.roster()) : [];
      return { group: summary, membership, members };
    }),
  );
}

export function inviteLink(
  env: Env,
  request: Request,
  groupId: string,
  rotate: boolean,
): Promise<WorkflowResult<{ token: string; link: string }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const { group, summary } = yield* requireGroup(env, groupId);
      const result = yield* tryPromise(() =>
        rotate ? group.rotateOpenInvite(me.id) : group.ensureOpenInvite(me.id),
      );
      if (!result.ok) return yield* Effect.fail(failReason(result.reason));
      const origin = new URL(request.url).origin;
      return {
        token: result.token,
        link: `${origin}/clubs/${groupUrlName(summary)}?invite=${result.token}`,
      };
    }),
  );
}

export function renameGroupTitle(
  env: Env,
  request: Request,
  groupId: string,
  title: unknown,
): Promise<WorkflowResult<{ group: GroupSummary }>> {
  return titleWorkflow(env, request, groupId, (group, callerId) =>
    Effect.gen(function* () {
      if (typeof title !== "string") return yield* Effect.fail(fail(400, "invalid_request"));
      return yield* tryPromise(() => group.renameGroup(callerId, title));
    }),
  );
}

export function renameBookTitle(
  env: Env,
  request: Request,
  groupId: string,
  sourceId: unknown,
  title: unknown,
): Promise<WorkflowResult<{ group: GroupSummary }>> {
  return titleWorkflow(env, request, groupId, (group, callerId) =>
    Effect.gen(function* () {
      if (typeof sourceId !== "string" || typeof title !== "string") {
        return yield* Effect.fail(fail(400, "invalid_request"));
      }
      return yield* tryPromise(() => group.renameBook(callerId, sourceId, title));
    }),
  );
}

export function resolveBookTitle(
  env: Env,
  request: Request,
  groupId: string,
  sourceId: unknown,
  title: unknown,
): Promise<WorkflowResult<{ group: GroupSummary }>> {
  return titleWorkflow(env, request, groupId, (group, callerId) =>
    Effect.gen(function* () {
      if (typeof sourceId !== "string" || typeof title !== "string") {
        return yield* Effect.fail(fail(400, "invalid_request"));
      }
      return yield* tryPromise(() => group.resolveBookTitle(callerId, sourceId, title));
    }),
  );
}

export function inviteByEmail(
  env: Env,
  request: Request,
  groupId: string,
  rawEmail: unknown,
): Promise<WorkflowResult<null>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const email = normalizeEmail(rawEmail);
      if (!email) return yield* Effect.fail(fail(400, "invalid_email"));
      const { group, summary } = yield* requireGroup(env, groupId);
      const result = yield* tryPromise(() => group.invite(me.id, email));
      if (!result.ok) return yield* Effect.fail(failReason(result.reason));
      const origin = new URL(request.url).origin;
      yield* tryPromise(() =>
        sendInvite(
          env,
          email,
          summary.displayName,
          `${origin}/clubs/${groupUrlName(summary)}?invite=${result.token}`,
        ),
      );
      return null;
    }),
  );
}

export function redeemInvite(
  env: Env,
  request: Request,
  groupId: string,
  token: unknown,
): Promise<WorkflowResult<{ group: GroupSummary }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      if (typeof token !== "string" || token === "")
        return yield* Effect.fail(fail(400, "invalid_request"));
      const { group } = yield* requireGroup(env, groupId);
      const result = yield* tryPromise(() => group.redeem(token, me));
      if (!result.ok) return yield* Effect.fail(failReason(result.reason));
      return { group: result.summary };
    }),
  );
}

export function uploadSource(
  env: Env,
  request: Request,
  groupId: string,
): Promise<WorkflowResult<{ hash: string }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const { group } = yield* requireGroupMember(env, me, groupId);
      const bytes = yield* tryPromise(() => request.arrayBuffer());
      const contentType = request.headers.get("Content-Type");
      const stored = yield* tryPromise(() => storeSource(env, bytes, contentType));
      if (!stored.ok) {
        return yield* Effect.fail(
          stored.reason === "empty" ? fail(400, "empty") : fail(400, "unsupported_type"),
        );
      }
      const rawTitle = request.headers.get("X-Source-Title");
      const title = rawTitle ? decodeURIComponent(rawTitle).trim() || null : null;
      const rawAuthor = request.headers.get("X-Source-Author");
      const author = rawAuthor ? decodeURIComponent(rawAuthor).trim() || null : null;
      const { id, kind, contentType: storedType, size } = stored.source;
      yield* tryPromise(() =>
        group.addSource(me.id, id, { kind, contentType: storedType, size, title, author }),
      );
      return { hash: id };
    }),
  );
}

export function fetchSource(
  env: Env,
  request: Request,
  groupId: string,
  sourceId?: string | null,
): Promise<WorkflowResult<{ hash: string; contentType: string; object: R2ObjectBody }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const { summary } = yield* requireGroupMember(env, me, groupId, "forbidden");
      const source = sourceId ? sourceById(summary, sourceId) : currentSource(summary);
      if (!source) return yield* Effect.fail(fail(404, "no_book"));
      const object = yield* tryPromise(() => getSource(env, source.id));
      if (!object) return yield* Effect.fail(fail(404, "no_book"));
      return { hash: source.id, contentType: source.contentType, object };
    }),
  );
}
