import { getAgentByName } from "agents";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { HttpApi, HttpApiBuilder, HttpApiGroup } from "effect/unstable/httpapi";
import { AccountsHttp } from "../../shared/http/accounts.ts";
import {
  BadRequest,
  Forbidden,
  InternalError,
  NotFound,
  TooLarge,
  Unauthenticated,
} from "../../shared/http/errors.ts";
import { Authentication, CurrentIdentity } from "./authentication.ts";
import { CloudflareEnv } from "./cloudflare.ts";
import { uploadedFile } from "./uploads.ts";
import type { StoredReadingPosition } from "../../shared/types/readingPositions.ts";
import type { StoredBookmark } from "../../shared/types/bookmarks.ts";
import { MAX_DISPLAY_NAME_LENGTH } from "../../shared/types/profiles.ts";
import { deleteImages, getImage, storeImage, validImageId } from "../services/images.ts";

const MigratedAccountsHttp = HttpApiGroup.make("migratedAccounts")
  .add(
    AccountsHttp.endpoints.prefs,
    AccountsHttp.endpoints.setPrefs,
    AccountsHttp.endpoints.readingPosition,
    AccountsHttp.endpoints.setReadingPosition,
    AccountsHttp.endpoints.bookmarks,
    AccountsHttp.endpoints.setBookmark,
    AccountsHttp.endpoints.uploadAvatar,
    AccountsHttp.endpoints.setClubProfile,
    AccountsHttp.endpoints.avatar,
  )
  .middleware(Authentication);

export const AccountsApi = HttpApi.make("bookclub-accounts").add(MigratedAccountsHttp);

const attempt = <A>(evaluate: () => Promise<A>) =>
  Effect.tryPromise({ try: evaluate, catch: () => new InternalError({ error: "internal_error" }) });

const sourceKind = Effect.fn("AccountHandlers.sourceKind")(function* (
  groupId: string,
  sourceId: string,
) {
  const env = yield* CloudflareEnv;
  const me = yield* CurrentIdentity;
  const group = yield* attempt(() => getAgentByName(env.GroupAgent, groupId));
  const membership = yield* attempt(() => group.membership(me.id));
  if (!membership.isMember) return yield* new Forbidden({ error: "not_member" });
  const summary = yield* attempt(() => group.getSummary());
  const meta = summary?.sourceMeta[sourceId];
  if (!summary || !summary.sources.includes(sourceId) || !meta) {
    return yield* new NotFound({ error: "bad_source" });
  }
  return meta.kind;
});

const avatarScope = (userId: string) => `avatars/${userId}`;

export const AccountHandlers = HttpApiBuilder.group(AccountsApi, "migratedAccounts", (handlers) =>
  handlers
    .handle("prefs", () =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, me.email));
        return { prefs: yield* attempt(() => auth.getPrefs()) };
      }),
    )
    .handle("setPrefs", ({ payload }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, me.email));
        return { prefs: yield* attempt(() => auth.setPrefs(payload.prefs)) };
      }),
    )
    .handle("readingPosition", ({ query }) =>
      Effect.gen(function* () {
        yield* sourceKind(query.groupId, query.sourceId);
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, me.email));
        return {
          position: yield* attempt<StoredReadingPosition | null>(async () =>
            auth.getReadingPosition(query.groupId, query.sourceId),
          ),
        };
      }),
    )
    .handle("setReadingPosition", ({ payload }) =>
      Effect.gen(function* () {
        const { position } = payload;
        if (position.groupId !== payload.groupId || position.sourceId !== payload.sourceId) {
          return yield* new BadRequest({ error: "invalid_request" });
        }
        const kind = yield* sourceKind(position.groupId, position.sourceId);
        if (kind !== position.kind) return yield* new BadRequest({ error: "kind_mismatch" });
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, me.email));
        return {
          position: yield* attempt<StoredReadingPosition>(async () =>
            auth.setReadingPosition(position),
          ),
        };
      }),
    )
    .handle("bookmarks", ({ query }) =>
      Effect.gen(function* () {
        yield* sourceKind(query.groupId, query.sourceId);
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, me.email));
        return {
          bookmarks: yield* attempt<StoredBookmark[]>(() =>
            auth.getBookmarks(query.groupId, query.sourceId),
          ),
        };
      }),
    )
    .handle("setBookmark", ({ payload }) =>
      Effect.gen(function* () {
        const { bookmark } = payload;
        const kind = yield* sourceKind(bookmark.groupId, bookmark.sourceId);
        if (kind !== bookmark.position.kind) {
          return yield* new BadRequest({ error: "kind_mismatch" });
        }
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, me.email));
        return { bookmarks: yield* attempt<StoredBookmark[]>(() => auth.setBookmark(bookmark)) };
      }),
    )
    .handle("uploadAvatar", ({ payload }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, me.email));
        const previous = yield* attempt(() => auth.getUser());
        const upload = yield* uploadedFile(payload);
        const stored = yield* attempt(() =>
          storeImage(env, avatarScope(me.id), upload.bytes, upload.contentType),
        );
        if (!stored.ok) {
          return yield* stored.reason === "too_large"
            ? new TooLarge({ error: stored.reason })
            : new BadRequest({ error: stored.reason });
        }
        const user = yield* attempt(async () => auth.setAvatarImageId(stored.image.id));
        if (!user) return yield* new Unauthenticated({ error: "unauthenticated" });
        yield* Effect.forEach(user.groupIds, (groupId) =>
          Effect.gen(function* () {
            const group = yield* attempt(() => getAgentByName(env.GroupAgent, groupId));
            const displayName = user.clubDisplayNames?.[groupId] ?? user.displayName;
            const profile = yield* attempt(() =>
              group.setMemberProfile(user.id, displayName, stored.image.id),
            );
            if (!profile) return;
            const notes = yield* attempt(() => getAgentByName(env.NoteAgent, groupId));
            yield* attempt(() => notes.updateMemberProfile(user.id, displayName, stored.image.id));
          }),
        );
        const previousAvatarImageId = previous?.avatarImageId;
        if (previousAvatarImageId && previousAvatarImageId !== stored.image.id) {
          yield* attempt(() => deleteImages(env, avatarScope(me.id), [previousAvatarImageId]));
        }
        return stored.image;
      }),
    )
    .handle("setClubProfile", ({ params, payload }) =>
      Effect.gen(function* () {
        const displayName = payload.displayName.trim();
        if (!displayName) return yield* new BadRequest({ error: "invalid_name" });
        const name = displayName.slice(0, MAX_DISPLAY_NAME_LENGTH);
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const group = yield* attempt(() => getAgentByName(env.GroupAgent, params.groupRef));
        const membership = yield* attempt(() => group.membership(me.id));
        if (!membership.isMember) return yield* new Forbidden({ error: "not_member" });
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, me.email));
        const user = yield* attempt(async () => auth.setClubDisplayName(params.groupRef, name));
        if (!user) return yield* new Unauthenticated({ error: "unauthenticated" });
        const member = yield* attempt(() =>
          group.setMemberProfile(me.id, name, user.avatarImageId),
        );
        if (!member) return yield* new Forbidden({ error: "not_member" });
        const notes = yield* attempt(() => getAgentByName(env.NoteAgent, params.groupRef));
        yield* attempt(() => notes.updateMemberProfile(me.id, name, user.avatarImageId));
        const profile = { id: me.id, displayName: name };
        return {
          profile: user.avatarImageId ? { ...profile, avatarImageId: user.avatarImageId } : profile,
        };
      }),
    )
    .handleRaw("avatar", ({ params }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        yield* CurrentIdentity;
        if (!validImageId(params.imageId)) return yield* new NotFound({ error: "not_found" });
        const object = yield* attempt(() =>
          getImage(env, avatarScope(params.userId), params.imageId),
        );
        if (!object) return yield* new NotFound({ error: "not_found" });
        return HttpServerResponse.raw(object.body, {
          headers: {
            "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
            "cache-control": "private, max-age=3600",
          },
        });
      }),
    ),
);
