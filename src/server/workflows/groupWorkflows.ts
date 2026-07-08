import { getAgentByName } from "agents";
import { Effect } from "effect";
import { monotonicFactory } from "ulidx";
import { groupUrlName, publicIdFromGroupUrl } from "../../shared/groupUrls.ts";
import {
  GroupFailureReason,
  isGroupRole,
  type GroupSummary,
  type Membership,
  type RosterEntry,
} from "../../shared/types/groups.ts";
import { currentSource, sourceById } from "../../shared/sources.ts";
import { deleteImagesForScope, getImage, storeImage, validImageId } from "../services/images.ts";
import { getSource, storeSource } from "../services/sources.ts";
import { sendInvite } from "../services/email.ts";
import type { Env } from "../env.ts";
import type {
  DeleteGroupResult,
  DeleteSourceResult,
  GroupAgent,
  Identity,
  RenameGroupResult,
  RenameResult,
  SetRoleResult,
} from "../state/GroupAgent.ts";
import type { NoteAgent } from "../state/NoteAgent.ts";
import { REGISTRY_ID, type GroupRegistry } from "../state/GroupRegistry.ts";
import { randomId } from "../../shared/crypto.ts";
import { canonicalEmail, normalizeEmail } from "../../shared/email.ts";
import {
  GroupAction,
  permits,
  type GroupAction as GroupActionType,
} from "../../shared/groupPermissions.ts";
import {
  fail,
  requireIdentity,
  runWorkflow,
  tryPromise,
  WorkflowError,
  WorkflowReason,
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
    return yield* Effect.fail(fail(503, WorkflowError.IdExhausted));
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
    if (!publicId) return yield* Effect.fail(fail(404, GroupFailureReason.NotFound));
    const registry = yield* registryFor(env);
    const groupId = yield* tryPromise(() => registry.resolvePublicId(publicId));
    if (!groupId) return yield* Effect.fail(fail(404, GroupFailureReason.NotFound));
    return (yield* tryPromise(() => getAgentByName(env.GroupAgent, groupId))) as unknown as Group;
  });

const requireGroup = (env: Env, groupRef: string): WorkflowEffect<ResolvedGroup> =>
  Effect.gen(function* () {
    const group = yield* resolveGroup(env, groupRef);
    const summary = yield* tryPromise(() => group.getSummary());
    if (!summary) return yield* Effect.fail(fail(404, GroupFailureReason.NotFound));
    return { group, summary };
  });

const requireGroupAction = (
  env: Env,
  me: Identity,
  groupRef: string,
  action: GroupActionType,
  denyError: WorkflowError = GroupFailureReason.Forbidden,
): WorkflowEffect<ResolvedGroup> =>
  Effect.gen(function* () {
    const resolved = yield* requireGroup(env, groupRef);
    const membership = yield* tryPromise(() => resolved.group.membership(me.id));
    if (!membership.isMember || membership.role === null) {
      return yield* Effect.fail(fail(403, GroupFailureReason.NotMember));
    }
    if (!permits(membership.role, action)) return yield* Effect.fail(fail(403, denyError));
    return resolved;
  });

type FailureReason = GroupFailureReason;

const REASON_STATUS: Record<FailureReason, number> = {
  [GroupFailureReason.Exists]: 409,
  [GroupFailureReason.NotMember]: 403,
  [GroupFailureReason.NotFound]: 404,
  [GroupFailureReason.Empty]: 400,
  [GroupFailureReason.BadSource]: 404,
  [GroupFailureReason.BadInvite]: 403,
  [GroupFailureReason.WrongEmail]: 403,
  [GroupFailureReason.Forbidden]: 403,
  [GroupFailureReason.BadMember]: 404,
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
        return yield* Effect.fail(fail(400, WorkflowError.InvalidName, WorkflowReason.Empty));
      }
      const displayName = rawDisplayName.trim();
      if (displayName === "") {
        return yield* Effect.fail(fail(400, WorkflowError.InvalidName, WorkflowReason.Empty));
      }
      if (displayName.length > MAX_GROUP_TITLE_LENGTH) {
        return yield* Effect.fail(fail(400, WorkflowError.InvalidName, WorkflowReason.TooLong));
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
      if (typeof title !== "string") {
        return yield* Effect.fail(fail(400, WorkflowError.InvalidRequest));
      }
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
        return yield* Effect.fail(fail(400, WorkflowError.InvalidRequest));
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
        return yield* Effect.fail(fail(400, WorkflowError.InvalidRequest));
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
      if (!email) return yield* Effect.fail(fail(400, WorkflowError.InvalidEmail));
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
        return yield* Effect.fail(fail(400, WorkflowError.InvalidRequest));
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
      const { group } = yield* requireGroupAction(env, me, groupId, GroupAction.UploadBook);
      const bytes = yield* tryPromise(() => request.arrayBuffer());
      const contentType = request.headers.get("Content-Type");
      const stored = yield* tryPromise(() => storeSource(env, bytes, contentType));
      if (!stored.ok) {
        return yield* Effect.fail(
          stored.reason === GroupFailureReason.Empty
            ? fail(400, GroupFailureReason.Empty)
            : fail(400, WorkflowError.UnsupportedType),
        );
      }
      const rawTitle = request.headers.get("X-Source-Title");
      const title = rawTitle ? decodeURIComponent(rawTitle).trim() || null : null;
      const rawAuthor = request.headers.get("X-Source-Author");
      const author = rawAuthor ? decodeURIComponent(rawAuthor).trim() || null : null;
      const { id, kind, contentType: storedType, size } = stored.source;
      yield* tryPromise(() =>
        group.addSource(me.id, id, {
          kind,
          contentType: storedType,
          size,
          title,
          author,
          addedBy: me.id,
        }),
      );
      return { hash: id };
    }),
  );
}

export function changeMemberRole(
  env: Env,
  request: Request,
  groupId: string,
  memberId: string,
  rawRole: unknown,
): Promise<WorkflowResult<{ members: RosterEntry[] }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      if (!isGroupRole(rawRole)) {
        return yield* Effect.fail(fail(400, WorkflowError.InvalidRequest));
      }
      const { group, summary } = yield* requireGroup(env, groupId);
      const result: SetRoleResult = yield* tryPromise(() =>
        group.setMemberRole(me.id, memberId, rawRole),
      );
      if (!result.ok) return yield* Effect.fail(failReason(result.reason));
      const notes = (yield* tryPromise(() =>
        getAgentByName(env.NoteAgent, summary.groupId),
      )) as unknown as Async<NoteAgent>;
      yield* tryPromise(() => notes.updateMemberRole(memberId, rawRole));
      return { members: result.roster };
    }),
  );
}

export function deleteBook(
  env: Env,
  request: Request,
  groupId: string,
  sourceId: unknown,
): Promise<WorkflowResult<{ group: GroupSummary }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      if (typeof sourceId !== "string") {
        return yield* Effect.fail(fail(400, WorkflowError.InvalidRequest));
      }
      const { group, summary } = yield* requireGroup(env, groupId);
      const result: DeleteSourceResult = yield* tryPromise(() =>
        group.deleteSource(me.id, sourceId),
      );
      if (!result.ok) return yield* Effect.fail(failReason(result.reason));
      const notes = (yield* tryPromise(() =>
        getAgentByName(env.NoteAgent, summary.groupId),
      )) as unknown as Async<NoteAgent>;
      yield* tryPromise(() => notes.removeSource(sourceId));
      return { group: result.summary };
    }),
  );
}

export function deleteGroup(
  env: Env,
  request: Request,
  groupId: string,
): Promise<WorkflowResult<null>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const { group, summary } = yield* requireGroup(env, groupId);
      const result: DeleteGroupResult = yield* tryPromise(() => group.deleteGroup(me.id));
      if (!result.ok) return yield* Effect.fail(failReason(result.reason));

      const registry = yield* registryFor(env);
      yield* tryPromise(() => registry.releaseGroup(result.groupId));
      yield* Effect.forEach(
        result.members,
        (member) =>
          Effect.gen(function* () {
            const auth = yield* tryPromise(() =>
              getAgentByName(env.AuthAgent, canonicalEmail(member.email)),
            );
            yield* tryPromise(() => auth.removeGroup(result.groupId));
          }),
        { concurrency: "unbounded", discard: true },
      );
      const notes = (yield* tryPromise(() =>
        getAgentByName(env.NoteAgent, summary.groupId),
      )) as unknown as Async<NoteAgent>;
      yield* tryPromise(() => notes.clear());
      yield* tryPromise(() => deleteImagesForScope(env, summary.groupId));
      return null;
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
      const { summary } = yield* requireGroupAction(env, me, groupId, GroupAction.ReadBook);
      const source = sourceId ? sourceById(summary, sourceId) : currentSource(summary);
      if (!source) return yield* Effect.fail(fail(404, WorkflowError.NoBook));
      const object = yield* tryPromise(() => getSource(env, source.id));
      if (!object) return yield* Effect.fail(fail(404, WorkflowError.NoBook));
      return { hash: source.id, contentType: source.contentType, object };
    }),
  );
}

export function uploadImage(
  env: Env,
  request: Request,
  groupId: string,
): Promise<WorkflowResult<{ id: string; contentType: string; size: number }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const { summary } = yield* requireGroupAction(env, me, groupId, GroupAction.UploadNoteImage);
      const bytes = yield* tryPromise(() => request.arrayBuffer());
      const stored = yield* tryPromise(() =>
        storeImage(env, summary.groupId, bytes, request.headers.get("Content-Type")),
      );
      if (!stored.ok) {
        const status = stored.reason === "too_large" ? 413 : 400;
        return yield* Effect.fail(fail(status, stored.reason));
      }
      return stored.image;
    }),
  );
}

export function fetchImage(
  env: Env,
  request: Request,
  groupId: string,
  imageId: string,
): Promise<WorkflowResult<{ object: R2ObjectBody; contentType: string }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const { summary } = yield* requireGroupAction(env, me, groupId, GroupAction.ViewClub);
      if (!validImageId(imageId)) {
        return yield* Effect.fail(fail(404, GroupFailureReason.NotFound));
      }
      const object = yield* tryPromise(() => getImage(env, summary.groupId, imageId));
      if (!object) return yield* Effect.fail(fail(404, GroupFailureReason.NotFound));
      return {
        object,
        contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
      };
    }),
  );
}
