import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { BookclubHttp } from "../../shared/http/BookclubHttp.ts";
import {
  BadRequest,
  Forbidden,
  NotFound,
  TooLarge,
  Unauthenticated,
} from "../../shared/http/errors.ts";
import { CurrentIdentity } from "../../shared/http/middleware.ts";
import { avatarScope, getImage, storeImage } from "../services/images.ts";
import { CloudflareEnv } from "./cloudflare.ts";
import { authAgent, groupAgent, io } from "./io.ts";
import { uploadedFile } from "./uploads.ts";

const myAccount = Effect.flatMap(CurrentIdentity, (me) => authAgent(me.email));

/** The kind of a book the caller can read, so a stored position cannot describe another format. */
const sourceKind = Effect.fn("sourceKind")(function* (groupId: string, sourceId: string) {
  const me = yield* CurrentIdentity;
  const group = yield* groupAgent(groupId);
  const { isMember } = yield* io(() => group.membership(me.id));
  if (!isMember) return yield* new Forbidden({ error: "not_member" });
  const summary = yield* io(() => group.getSummary());
  const meta = summary?.sourceMeta[sourceId];
  if (!summary?.sources.includes(sourceId) || !meta) {
    return yield* new NotFound({ error: "bad_source" });
  }
  return meta.kind;
});

export const AccountHandlers = HttpApiBuilder.group(BookclubHttp, "accounts", (handlers) =>
  handlers
    .handle("prefs", () =>
      Effect.gen(function* () {
        const auth = yield* myAccount;
        return { prefs: yield* io(() => auth.getPrefs()) };
      }),
    )
    .handle("setPrefs", ({ payload }) =>
      Effect.gen(function* () {
        const auth = yield* myAccount;
        return { prefs: yield* io(() => auth.setPrefs(payload.prefs)) };
      }),
    )
    .handle("readingPosition", ({ query }) =>
      Effect.gen(function* () {
        yield* sourceKind(query.groupId, query.sourceId);
        const auth = yield* myAccount;
        return {
          position: yield* io(() => auth.getReadingPosition(query.groupId, query.sourceId)),
        };
      }),
    )
    .handle("setReadingPosition", ({ payload: { position } }) =>
      Effect.gen(function* () {
        const kind = yield* sourceKind(position.groupId, position.sourceId);
        if (kind !== position.kind) return yield* new BadRequest({ error: "kind_mismatch" });
        const auth = yield* myAccount;
        return { position: yield* io(() => auth.setReadingPosition(position)) };
      }),
    )
    .handle("bookmarks", ({ query }) =>
      Effect.gen(function* () {
        yield* sourceKind(query.groupId, query.sourceId);
        const auth = yield* myAccount;
        return { bookmarks: yield* io(() => auth.getBookmarks(query.groupId, query.sourceId)) };
      }),
    )
    .handle("setBookmark", ({ payload: { bookmark } }) =>
      Effect.gen(function* () {
        const kind = yield* sourceKind(bookmark.groupId, bookmark.sourceId);
        if (kind !== bookmark.position.kind) {
          return yield* new BadRequest({ error: "kind_mismatch" });
        }
        const auth = yield* myAccount;
        return { bookmarks: yield* io(() => auth.setBookmark(bookmark)) };
      }),
    )
    .handle("uploadAvatar", ({ payload }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const upload = yield* uploadedFile(payload);
        const stored = yield* io(() =>
          storeImage(env, avatarScope(me.id), upload.bytes, upload.contentType),
        );
        if (!stored.ok) {
          return yield* stored.reason === "too_large"
            ? new TooLarge({ error: stored.reason })
            : new BadRequest({ error: stored.reason });
        }
        const auth = yield* myAccount;
        const user = yield* io(() => auth.setAvatarImageId(stored.image.id));
        if (!user) return yield* new Unauthenticated({ error: "unauthenticated" });
        return stored.image;
      }),
    )
    .handle("setClubProfile", ({ params, payload }) =>
      Effect.gen(function* () {
        const me = yield* CurrentIdentity;
        const group = yield* groupAgent(params.groupRef);
        const { isMember } = yield* io(() => group.membership(me.id));
        if (!isMember) return yield* new Forbidden({ error: "not_member" });
        const auth = yield* myAccount;
        const user = yield* io(() => auth.setClubDisplayName(params.groupRef, payload.displayName));
        if (!user) return yield* new Unauthenticated({ error: "unauthenticated" });
        const profile = { id: me.id, displayName: payload.displayName };
        return {
          profile: user.avatarImageId ? { ...profile, avatarImageId: user.avatarImageId } : profile,
        };
      }),
    )
    .handleRaw("avatar", ({ params }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const object = yield* io(() => getImage(env, avatarScope(params.userId), params.imageId));
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
