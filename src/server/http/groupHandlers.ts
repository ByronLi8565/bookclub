import { getAgentByName } from "agents";
import { Effect } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { HttpApi, HttpApiBuilder, HttpApiGroup } from "effect/unstable/httpapi";
import { monotonicFactory } from "ulidx";
import { randomId } from "../../shared/crypto.ts";
import { canonicalEmail, normalizeEmail } from "../../shared/email.ts";
import { groupUrlName, publicIdFromGroupUrl } from "../../shared/groupUrls.ts";
import { GroupsHttp } from "../../shared/http/groups.ts";
import {
  BadRequest,
  Conflict,
  Forbidden,
  InternalError,
  NotFound,
  ServiceUnavailable,
} from "../../shared/http/errors.ts";
import {
  GroupFailureReason,
  type BookMetadataPatch,
  type GroupSummary,
} from "../../shared/types/groups.ts";
import { deleteImagesForScope } from "../services/images.ts";
import { sendInvite } from "../services/email.ts";
import type { GroupAgent, RenameGroupResult, RenameResult } from "../state/GroupAgent.ts";
import { Authentication, CurrentIdentity } from "./authentication.ts";
import { CloudflareEnv } from "./cloudflare.ts";

const MAX_GROUP_TITLE_LENGTH = 100;
const ulid = monotonicFactory();
type Group = DurableObjectStub<GroupAgent>;

const MigratedGroupsHttp = HttpApiGroup.make("migratedGroups")
  .add(
    GroupsHttp.endpoints.list,
    GroupsHttp.endpoints.create,
    GroupsHttp.endpoints.get,
    GroupsHttp.endpoints.inviteLink,
    GroupsHttp.endpoints.rename,
    GroupsHttp.endpoints.renameBook,
    GroupsHttp.endpoints.resolveBookTitle,
    GroupsHttp.endpoints.invite,
    GroupsHttp.endpoints.setMemberRole,
    GroupsHttp.endpoints.join,
    GroupsHttp.endpoints.deleteBook,
    GroupsHttp.endpoints.updateBookMetadata,
    GroupsHttp.endpoints.delete,
  )
  .middleware(Authentication);

export const GroupsApi = HttpApi.make("bookclub-groups").add(MigratedGroupsHttp);

export const attempt = <A>(evaluate: () => A) =>
  Effect.tryPromise({
    try: () => Promise.resolve(evaluate()),
    catch: () => new InternalError({ error: "internal_error" }),
  });

export const groupFailure = (reason: GroupFailureReason) => {
  switch (reason) {
    case GroupFailureReason.Exists:
      return new Conflict({ error: reason });
    case GroupFailureReason.NotFound:
    case GroupFailureReason.BadSource:
    case GroupFailureReason.BadMember:
      return new NotFound({ error: reason });
    case GroupFailureReason.Empty:
      return new BadRequest({ error: reason });
    default:
      return new Forbidden({ error: reason });
  }
};
const failure = groupFailure;

const registry = Effect.fn("GroupHandlers.registry")(function* () {
  const env = yield* CloudflareEnv;
  return yield* attempt(() => getAgentByName(env.GroupRegistry, "global"));
});

const reservePublicId = Effect.fn("GroupHandlers.reservePublicId")(function* (groupId: string) {
  const groupRegistry = yield* registry();
  for (let tries = 0; tries < 10; tries++) {
    const publicId = randomId(6, "abcdefghijklmnopqrstuvwxyz0123456789");
    const result = yield* attempt(async () => groupRegistry.reservePublicId(publicId, groupId));
    if (result.ok) return publicId;
  }
  return yield* new ServiceUnavailable({ error: "id_exhausted" });
});

export const resolveGroup = Effect.fn("GroupHandlers.resolveGroup")(function* (groupRef: string) {
  const publicId = publicIdFromGroupUrl(groupRef);
  if (!publicId) return yield* new NotFound({ error: "not_found" });
  const env = yield* CloudflareEnv;
  const groupRegistry = yield* registry();
  const groupId = yield* attempt(() => groupRegistry.resolvePublicId(publicId));
  if (!groupId) return yield* new NotFound({ error: "not_found" });
  const group = yield* attempt(() => getAgentByName(env.GroupAgent, groupId));
  const summary = yield* attempt(() => group.getSummary());
  if (!summary) return yield* new NotFound({ error: "not_found" });
  return { group, summary };
});

const ensurePublicUrl = Effect.fn("GroupHandlers.ensurePublicUrl")(function* (
  group: Group,
  summary: GroupSummary,
) {
  if (summary.publicId !== "") return summary;
  const publicId = yield* reservePublicId(summary.groupId);
  const updated = yield* attempt(() => group.assignPublicUrl(publicId));
  return updated ?? summary;
});

const titleResult = Effect.fn("GroupHandlers.titleResult")(function* (
  groupRef: string,
  rename: (callerId: string, group: Group) => Promise<RenameResult | RenameGroupResult>,
) {
  const me = yield* CurrentIdentity;
  const { group } = yield* resolveGroup(groupRef);
  const result = yield* attempt(async () => rename(me.id, group));
  if (!result.ok) return yield* failure(result.reason);
  return { group: result.summary };
});

export const GroupHandlers = HttpApiBuilder.group(GroupsApi, "migratedGroups", (handlers) =>
  handlers
    .handle("list", () =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, me.email));
        const ids = yield* attempt(() => auth.getGroupIds());
        const groups = yield* Effect.forEach(ids, (id) =>
          Effect.gen(function* () {
            const group = yield* attempt(() => getAgentByName(env.GroupAgent, id));
            const summary = yield* attempt(() => group.getSummary());
            return summary ? yield* ensurePublicUrl(group, summary) : null;
          }),
        );
        return { groups: groups.filter((group) => group !== null) };
      }),
    )
    .handle("create", ({ payload }) =>
      Effect.gen(function* () {
        const displayName = payload.displayName.trim();
        if (!displayName) return yield* new BadRequest({ error: "invalid_name", reason: "empty" });
        if (displayName.length > MAX_GROUP_TITLE_LENGTH) {
          return yield* new BadRequest({ error: "invalid_name", reason: "too_long" });
        }
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const groupId = ulid();
        const publicId = yield* reservePublicId(groupId);
        const group = yield* attempt(() => getAgentByName(env.GroupAgent, groupId));
        const result = yield* attempt(async () => group.create(displayName, publicId, me));
        if (!result.ok) return yield* failure(result.reason);
        return { group: result.summary };
      }),
    )
    .handle("get", ({ params }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const { group, summary } = yield* resolveGroup(params.groupRef);
        const membership = yield* attempt(() => group.membership(me.id));
        if (membership.isMember) {
          yield* attempt(() => group.reindexMember(me));
          const auth = yield* attempt(() => getAgentByName(env.AuthAgent, me.email));
          const profile = yield* attempt(() => auth.getClubProfile(summary.groupId));
          if (profile) {
            yield* attempt(() =>
              group.setMemberProfile(me.id, profile.displayName, profile.avatarImageId),
            );
          }
        }
        return {
          group: summary,
          membership,
          members: membership.isMember ? yield* attempt(() => group.roster()) : [],
        };
      }),
    )
    .handle("inviteLink", ({ params, query }) =>
      Effect.gen(function* () {
        const me = yield* CurrentIdentity;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const { group, summary } = yield* resolveGroup(params.groupRef);
        const result = yield* attempt(async () =>
          query.rotate === "1" ? group.rotateOpenInvite(me.id) : group.ensureOpenInvite(me.id),
        );
        if (!result.ok) return yield* failure(result.reason);
        return {
          token: result.token,
          link: `${new URL(request.url, "http://localhost").origin}/clubs/${groupUrlName(summary)}?invite=${result.token}`,
        };
      }),
    )
    .handle("rename", ({ params, payload }) =>
      titleResult(params.groupRef, (callerId, group) => group.renameGroup(callerId, payload.title)),
    )
    .handle("renameBook", ({ params, payload }) =>
      titleResult(params.groupRef, (callerId, group) =>
        group.renameBook(callerId, payload.sourceId, payload.title),
      ),
    )
    .handle("resolveBookTitle", ({ params, payload }) =>
      titleResult(params.groupRef, (callerId, group) =>
        group.resolveBookTitle(callerId, payload.sourceId, payload.title),
      ),
    )
    .handle("invite", ({ params, payload }) =>
      Effect.gen(function* () {
        const email = normalizeEmail(payload.email);
        if (!email) return yield* new BadRequest({ error: "invalid_email" });
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const { group, summary } = yield* resolveGroup(params.groupRef);
        const result = yield* attempt(async () => group.invite(me.id, email));
        if (!result.ok) return yield* failure(result.reason);
        yield* attempt(() =>
          sendInvite(
            env,
            email,
            summary.displayName,
            `${new URL(request.url, "http://localhost").origin}/clubs/${groupUrlName(summary)}?invite=${result.token}`,
          ),
        );
      }),
    )
    .handle("setMemberRole", ({ params, payload }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const { group, summary } = yield* resolveGroup(params.groupRef);
        const result = yield* attempt(async () =>
          group.setMemberRole(me.id, params.memberId, payload.role),
        );
        if (!result.ok) return yield* failure(result.reason);
        const notes = yield* attempt(() => getAgentByName(env.NoteAgent, summary.groupId));
        yield* attempt(() => notes.updateMemberRole(params.memberId, payload.role));
        return { members: result.roster };
      }),
    )
    .handle("join", ({ params, payload }) =>
      Effect.gen(function* () {
        const me = yield* CurrentIdentity;
        const { group } = yield* resolveGroup(params.groupRef);
        const result = yield* attempt(async () => group.redeem(payload.token, me));
        if (!result.ok) return yield* failure(result.reason);
        return { group: result.summary };
      }),
    )
    .handle("deleteBook", ({ params }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const { group, summary } = yield* resolveGroup(params.groupRef);
        const result = yield* attempt(async () => group.deleteSource(me.id, params.sourceId));
        if (!result.ok) return yield* failure(result.reason);
        const notes = yield* attempt(() => getAgentByName(env.NoteAgent, summary.groupId));
        yield* attempt(() => notes.removeSource(params.sourceId));
        return { group: result.summary };
      }),
    )
    .handle("updateBookMetadata", ({ params, payload }) =>
      Effect.gen(function* () {
        const patch: BookMetadataPatch = {};
        if (Object.hasOwn(payload, "author")) {
          const author = payload.author?.trim();
          patch.author = author ? author.slice(0, 200) : null;
        }
        if (Object.hasOwn(payload, "wordCount")) {
          if (
            payload.wordCount === undefined ||
            (payload.wordCount !== null &&
              (!Number.isSafeInteger(payload.wordCount) || payload.wordCount < 0))
          ) {
            return yield* new BadRequest({ error: "invalid_request" });
          }
          patch.wordCount = payload.wordCount;
        }
        if (!Object.hasOwn(patch, "author") && !Object.hasOwn(patch, "wordCount")) {
          return yield* new BadRequest({ error: "invalid_request" });
        }
        const me = yield* CurrentIdentity;
        const { group } = yield* resolveGroup(params.groupRef);
        const result = yield* attempt(async () =>
          group.updateBookMetadata(me.id, params.sourceId, patch),
        );
        if (!result.ok) return yield* failure(result.reason);
        return { group: result.summary };
      }),
    )
    .handle("delete", ({ params }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const { group, summary } = yield* resolveGroup(params.groupRef);
        const result = yield* attempt(async () => group.deleteGroup(me.id));
        if (!result.ok) return yield* failure(result.reason);
        const groupRegistry = yield* registry();
        yield* attempt(async () => groupRegistry.releaseGroup(result.groupId));
        yield* Effect.forEach(result.members, (member) =>
          Effect.gen(function* () {
            const auth = yield* attempt(() =>
              getAgentByName(env.AuthAgent, canonicalEmail(member.email)),
            );
            yield* attempt(async () => auth.removeGroup(result.groupId));
          }),
        );
        const notes = yield* attempt(() => getAgentByName(env.NoteAgent, summary.groupId));
        yield* attempt(async () => notes.clear());
        yield* attempt(() => deleteImagesForScope(env, summary.groupId));
      }),
    ),
);
