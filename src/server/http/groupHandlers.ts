import { Effect } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { monotonicFactory } from "ulidx";
import { groupUrlName } from "../../shared/groupUrls.ts";
import { BookclubHttp } from "../../shared/http/BookclubHttp.ts";
import { NotFound } from "../../shared/http/errors.ts";
import { CurrentIdentity } from "../../shared/http/middleware.ts";
import type { GroupSummary } from "../../shared/types/groups.ts";
import { sendInvite } from "../services/email.ts";
import type { GroupAgent } from "../state/GroupAgent.ts";
import { CloudflareEnv } from "./cloudflare.ts";
import * as GroupData from "./groupDataHandlers.ts";
import { ensurePublicUrl, reservePublicId, resolveGroup } from "./groupLookup.ts";
import { authAgent, groupAgent, groupCall, io, noteAgent } from "./io.ts";

const ulid = monotonicFactory();

const groupInviteUrl = (
  request: HttpServerRequest.HttpServerRequest,
  group: GroupSummary,
  token: string,
  sourceId?: string,
): string => {
  const query = new URLSearchParams({ invite: token });
  if (sourceId !== undefined && group.sources.includes(sourceId)) query.set("book", sourceId);
  return new URL(`/clubs/${groupUrlName(group)}?${query}`, request.originalUrl).href;
};

/** Runs a member's change against the club behind `groupRef` and answers with the new summary. */
const changeGroup = Effect.fn("changeGroup")(function* (
  groupRef: string,
  change: (
    group: DurableObjectStub<GroupAgent>,
    callerId: string,
  ) => ReturnType<GroupAgent["renameGroup"]> | Promise<ReturnType<GroupAgent["renameGroup"]>>,
) {
  const me = yield* CurrentIdentity;
  const { group } = yield* resolveGroup(groupRef);
  const { summary } = yield* groupCall(async () => await change(group, me.id));
  return { group: summary };
});

export const GroupHandlers = HttpApiBuilder.group(BookclubHttp, "groups", (handlers) =>
  handlers
    .handle("list", () =>
      Effect.gen(function* () {
        const me = yield* CurrentIdentity;
        const auth = yield* authAgent(me.email);
        const ids = yield* io(() => auth.getGroupIds());
        const groups = yield* Effect.forEach(ids, (id) =>
          Effect.gen(function* () {
            const group = yield* groupAgent(id);
            const summary = yield* io(() => group.getSummary());
            return summary ? yield* ensurePublicUrl(group, summary) : null;
          }),
        );
        return { groups: groups.filter((group) => group !== null) };
      }),
    )
    .handle("create", ({ payload }) =>
      Effect.gen(function* () {
        const me = yield* CurrentIdentity;
        const groupId = ulid();
        const publicId = yield* reservePublicId(groupId);
        const group = yield* groupAgent(groupId);
        const { summary } = yield* groupCall(() => group.create(payload.displayName, publicId, me));
        return { group: summary };
      }),
    )
    .handle("get", ({ params }) =>
      Effect.gen(function* () {
        const me = yield* CurrentIdentity;
        const { group } = yield* resolveGroup(params.groupRef);
        const view = yield* io(() => group.view(me));
        return view ?? (yield* new NotFound({ error: "not_found" }));
      }),
    )
    .handle("inviteLink", ({ params, query }) =>
      Effect.gen(function* () {
        const me = yield* CurrentIdentity;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const { group, summary } = yield* resolveGroup(params.groupRef);
        const { token } = yield* groupCall(() =>
          query.rotate === "1" ? group.rotateOpenInvite(me.id) : group.ensureOpenInvite(me.id),
        );
        return { token, link: groupInviteUrl(request, summary, token, query.sourceId) };
      }),
    )
    .handle("rename", ({ params, payload }) =>
      changeGroup(params.groupRef, (group, callerId) => group.renameGroup(callerId, payload.title)),
    )
    .handle("renameBook", ({ params, payload }) =>
      changeGroup(params.groupRef, (group, callerId) =>
        group.renameBook(callerId, payload.sourceId, payload.title),
      ),
    )
    .handle("resolveBookTitle", ({ params, payload }) =>
      changeGroup(params.groupRef, (group, callerId) =>
        group.resolveBookTitle(callerId, payload.sourceId, payload.title),
      ),
    )
    .handle("invite", ({ params, payload }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const { group, summary } = yield* resolveGroup(params.groupRef);
        const { token } = yield* groupCall(() => group.invite(me.id, payload.email));
        const link = groupInviteUrl(request, summary, token, payload.sourceId);
        yield* io(() => sendInvite(env, payload.email, summary.displayName, link));
      }),
    )
    .handle("setMemberRole", ({ params, payload }) =>
      Effect.gen(function* () {
        const me = yield* CurrentIdentity;
        const { group } = yield* resolveGroup(params.groupRef);
        const { roster } = yield* groupCall(() =>
          group.setMemberRole(me.id, params.memberId, payload.role),
        );
        return { members: roster };
      }),
    )
    .handle("join", ({ params, payload }) =>
      Effect.gen(function* () {
        const me = yield* CurrentIdentity;
        const { group } = yield* resolveGroup(params.groupRef);
        const { summary } = yield* groupCall(() => group.redeem(payload.token, me));
        return { group: summary };
      }),
    )
    .handle("deleteBook", ({ params }) =>
      Effect.gen(function* () {
        const me = yield* CurrentIdentity;
        const { group, summary } = yield* resolveGroup(params.groupRef);
        const result = yield* groupCall(() => group.deleteSource(me.id, params.sourceId));
        const notes = yield* noteAgent(summary.groupId);
        yield* io(() => notes.removeSource(params.sourceId));
        return { group: result.summary };
      }),
    )
    .handle("updateBookMetadata", ({ params, payload }) =>
      changeGroup(params.groupRef, (group, callerId) =>
        group.updateBookMetadata(callerId, params.sourceId, payload),
      ),
    )
    .handle("delete", ({ params }) =>
      Effect.gen(function* () {
        const me = yield* CurrentIdentity;
        const { group } = yield* resolveGroup(params.groupRef);
        yield* groupCall(() => group.deleteGroup(me.id));
      }),
    )
    .handle("uploadBook", ({ params, headers, payload }) =>
      GroupData.uploadBook(params.groupRef, headers, payload),
    )
    .handleRaw("book", ({ params, query }) => GroupData.book(params.groupRef, query.sourceId))
    .handle("uploadImage", ({ params, payload }) => GroupData.uploadImage(params.groupRef, payload))
    .handle("images", ({ params }) => GroupData.images(params.groupRef))
    .handle("deleteImage", ({ params }) => GroupData.deleteImage(params.groupRef, params.imageId))
    .handleRaw("image", ({ params }) => GroupData.image(params.groupRef, params.imageId))
    .handleRaw("exportBackup", ({ params }) => GroupData.exportBackup(params.groupRef))
    .handle("restoreBackup", ({ params, payload }) =>
      GroupData.restoreBackup(params.groupRef, payload),
    ),
);
