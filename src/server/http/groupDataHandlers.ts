import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpApi, HttpApiBuilder, HttpApiGroup } from "effect/unstable/httpapi";
import { GroupsHttp } from "../../shared/http/groups.ts";
import { uploadedFile } from "./uploads.ts";
import {
  BadRequest,
  Conflict,
  Forbidden,
  InternalError,
  NotFound,
  TooLarge,
} from "../../shared/http/errors.ts";
import {
  BOOKCLUB_ARCHIVE_CONTENT_TYPE,
  BOOKCLUB_ARCHIVE_EXTENSION,
  BookclubArchiveError,
  MAX_BOOKCLUB_ARCHIVE_BYTES,
  createBookclubArchive,
  decodeBookclubArchive,
} from "../../shared/backups/bookclubArchive.ts";
import { noteImageIds } from "../../shared/notes/images.ts";
import { GroupFailureReason } from "../../shared/types/groups.ts";
import {
  GroupAction,
  permits,
  type GroupAction as GroupActionType,
} from "../../shared/groupPermissions.ts";
import { currentSource, sourceById } from "../../shared/sources.ts";
import { getSource, storeSource } from "../services/sources.ts";
import {
  deleteImages,
  getImage,
  imageKey,
  listImages,
  restoreImage,
  storeImage,
  validImageId,
} from "../services/images.ts";
import { getAgentByName } from "agents";
import { Authentication, CurrentIdentity } from "./authentication.ts";
import { CloudflareEnv } from "./cloudflare.ts";
import { attempt, groupFailure, resolveGroup } from "./groupHandlers.ts";

const MigratedGroupDataHttp = HttpApiGroup.make("migratedGroupData")
  .add(
    GroupsHttp.endpoints.uploadBook,
    GroupsHttp.endpoints.book,
    GroupsHttp.endpoints.uploadImage,
    GroupsHttp.endpoints.images,
    GroupsHttp.endpoints.deleteImage,
    GroupsHttp.endpoints.image,
    GroupsHttp.endpoints.exportBackup,
    GroupsHttp.endpoints.restoreBackup,
  )
  .middleware(Authentication);

export const GroupDataApi = HttpApi.make("bookclub-group-data").add(MigratedGroupDataHttp);

const requireAction = Effect.fn("GroupDataHandlers.requireAction")(function* (
  groupRef: string,
  action: GroupActionType,
) {
  const me = yield* CurrentIdentity;
  const resolved = yield* resolveGroup(groupRef);
  const membership = yield* attempt(() => resolved.group.membership(me.id));
  if (!membership.role) return yield* new Forbidden({ error: "not_member" });
  if (!permits(membership.role, action)) return yield* new Forbidden({ error: "forbidden" });
  return { ...resolved, me };
});

export const GroupDataHandlers = HttpApiBuilder.group(
  GroupDataApi,
  "migratedGroupData",
  (handlers) =>
    handlers
      .handle("uploadBook", ({ params, headers, payload }) =>
        Effect.gen(function* () {
          const env = yield* CloudflareEnv;
          const { group, me } = yield* requireAction(params.groupRef, GroupAction.UploadBook);
          const upload = yield* uploadedFile(payload);
          const stored = yield* attempt(() => storeSource(env, upload.bytes, upload.contentType));
          if (!stored.ok) {
            return yield* new BadRequest({
              error: stored.reason === GroupFailureReason.Empty ? "empty" : "unsupported_type",
            });
          }
          const decode = (value: string | undefined) =>
            value ? decodeURIComponent(value).trim() || null : null;
          const rawWordCount = headers["x-source-word-count"];
          const parsedWordCount = rawWordCount === undefined ? null : Number(rawWordCount);
          const wordCount =
            parsedWordCount !== null &&
            Number.isSafeInteger(parsedWordCount) &&
            parsedWordCount >= 0
              ? parsedWordCount
              : null;
          const source = stored.source;
          const result = yield* attempt(() =>
            group.addSource(me.id, source.id, {
              kind: source.kind,
              contentType: source.contentType,
              size: source.size,
              title: decode(headers["x-source-title"]),
              author: decode(headers["x-source-author"]),
              wordCount,
              addedBy: me.id,
            }),
          );
          if (!result.ok) return yield* groupFailure(result.reason);
          return { hash: source.id };
        }),
      )
      .handleRaw("book", ({ params, query }) =>
        Effect.gen(function* () {
          const env = yield* CloudflareEnv;
          const { summary } = yield* requireAction(params.groupRef, GroupAction.ReadBook);
          const source = query.sourceId
            ? sourceById(summary, query.sourceId)
            : currentSource(summary);
          if (!source) return yield* new NotFound({ error: "no_book" });
          const object = yield* attempt(() => getSource(env, source.id));
          if (!object) return yield* new NotFound({ error: "no_book" });
          return HttpServerResponse.raw(object.body, {
            headers: { "content-type": source.contentType, "x-source-id": source.id },
          });
        }),
      )
      .handle("uploadImage", ({ params, payload }) =>
        Effect.gen(function* () {
          const env = yield* CloudflareEnv;
          const { summary, me } = yield* requireAction(
            params.groupRef,
            GroupAction.UploadNoteImage,
          );
          const upload = yield* uploadedFile(payload);
          const stored = yield* attempt(() =>
            storeImage(env, summary.groupId, upload.bytes, upload.contentType, me.id),
          );
          if (!stored.ok) {
            return yield* stored.reason === "too_large"
              ? new TooLarge({ error: stored.reason })
              : new BadRequest({ error: stored.reason });
          }
          return stored.image;
        }),
      )
      .handle("images", ({ params }) =>
        Effect.gen(function* () {
          const env = yield* CloudflareEnv;
          const { group, summary } = yield* requireAction(params.groupRef, GroupAction.ViewClub);
          const [images, roster] = yield* Effect.all([
            attempt(() => listImages(env, summary.groupId)),
            attempt(() => group.roster()),
          ]);
          const names = new Map(roster.map((member) => [member.id, member.name]));
          return {
            images: images.map((image) => ({
              ...image,
              uploaderName: image.uploadedBy
                ? (names.get(image.uploadedBy) ?? "Unknown member")
                : "Unknown member",
            })),
            totalSize: images.reduce((total, image) => total + image.size, 0),
          };
        }),
      )
      .handle("deleteImage", ({ params }) =>
        Effect.gen(function* () {
          const env = yield* CloudflareEnv;
          const { group, summary, me } = yield* requireAction(
            params.groupRef,
            GroupAction.UploadNoteImage,
          );
          if (!validImageId(params.imageId)) return yield* new NotFound({ error: "not_found" });
          const object = yield* attempt(() =>
            env.IMAGES.head(imageKey(summary.groupId, params.imageId)),
          );
          if (!object) return;
          const notes = yield* attempt(() => getAgentByName(env.NoteAgent, summary.groupId));
          const membership = yield* attempt(() => group.membership(me.id));
          if (membership.role && permits(membership.role, GroupAction.DeleteAnyImage)) {
            yield* attempt(() => notes.deleteImage(params.imageId));
            return;
          }
          if (object.customMetadata?.uploadedBy !== me.id) {
            return yield* new Forbidden({ error: "forbidden" });
          }
          if (yield* attempt(() => notes.referencesImage(params.imageId))) {
            return yield* new Conflict({ error: "invalid_request" });
          }
          yield* attempt(() => deleteImages(env, summary.groupId, [params.imageId]));
        }),
      )
      .handleRaw("image", ({ params }) =>
        Effect.gen(function* () {
          const env = yield* CloudflareEnv;
          const { summary } = yield* requireAction(params.groupRef, GroupAction.ViewClub);
          if (!validImageId(params.imageId)) return yield* new NotFound({ error: "not_found" });
          const object = yield* attempt(() => getImage(env, summary.groupId, params.imageId));
          if (!object) return yield* new NotFound({ error: "not_found" });
          return HttpServerResponse.raw(object.body, {
            headers: {
              "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
              "cache-control": "private, max-age=3600",
            },
          });
        }),
      )
      .handleRaw("exportBackup", ({ params }) =>
        Effect.gen(function* () {
          const env = yield* CloudflareEnv;
          const { summary } = yield* requireAction(params.groupRef, GroupAction.ManageBackups);
          const notes = yield* attempt(() => getAgentByName(env.NoteAgent, summary.groupId));
          const state = yield* attempt(() => notes.exportState());
          const imageIds = new Set(state.notes.flatMap((note) => [...noteImageIds(note.body)]));
          const images = yield* Effect.forEach([...imageIds], (id) =>
            Effect.gen(function* () {
              const object = yield* attempt(() => getImage(env, summary.groupId, id));
              if (!object) return yield* new InternalError({ error: "internal_error" });
              return {
                id,
                contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
                uploadedBy: object.customMetadata?.uploadedBy ?? null,
                bytes: new Uint8Array(yield* attempt(() => object.arrayBuffer())),
              };
            }),
          );
          const createdAt = new Date().toISOString();
          const bytes = yield* attempt(() =>
            createBookclubArchive({
              createdAt,
              club: { id: summary.groupId, name: summary.displayName, publicId: summary.publicId },
              nextSeq: state.nextSeq,
              books: summary.sources.map((sourceId) => ({
                sourceId,
                title: summary.bookTitles[sourceId] ?? summary.sourceMeta[sourceId]?.title ?? null,
                meta: summary.sourceMeta[sourceId],
              })),
              notes: state.notes,
              images,
            }),
          );
          if (bytes.byteLength > MAX_BOOKCLUB_ARCHIVE_BYTES) {
            return yield* new TooLarge({ error: "too_large" });
          }
          const timestamp = createdAt.replaceAll(":", "-").replace(".", "-");
          return HttpServerResponse.uint8Array(bytes, {
            contentType: BOOKCLUB_ARCHIVE_CONTENT_TYPE,
            headers: {
              "content-disposition": `attachment; filename="${summary.slug}-${timestamp}${BOOKCLUB_ARCHIVE_EXTENSION}"`,
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            },
          });
        }),
      )
      .handle("restoreBackup", ({ params, payload }) =>
        Effect.gen(function* () {
          const env = yield* CloudflareEnv;
          const request = yield* HttpServerRequest.HttpServerRequest;
          const { summary } = yield* requireAction(params.groupRef, GroupAction.ManageBackups);
          const contentLength = Number(request.headers["content-length"]);
          if (Number.isFinite(contentLength) && contentLength > MAX_BOOKCLUB_ARCHIVE_BYTES) {
            return yield* new TooLarge({ error: "too_large" });
          }
          const upload = yield* uploadedFile(payload);
          const decoded = yield* attempt(() => decodeBookclubArchive(new Uint8Array(upload.bytes)));
          if (!decoded.ok) {
            return yield* decoded.error === BookclubArchiveError.TooLarge
              ? new TooLarge({ error: "too_large" })
              : new BadRequest({ error: "invalid_backup" });
          }
          const backup = decoded.value;
          if (backup.manifest.club.id !== summary.groupId) {
            return yield* new Conflict({ error: "backup_club_mismatch" });
          }
          const existing = yield* attempt(() => listImages(env, summary.groupId));
          yield* Effect.forEach(backup.images, (image) =>
            attempt(() =>
              restoreImage(
                env,
                summary.groupId,
                image.id,
                image.bytes,
                image.contentType,
                image.uploadedBy,
              ),
            ),
          );
          const notes = yield* attempt(() => getAgentByName(env.NoteAgent, summary.groupId));
          yield* attempt(() =>
            notes.importState({
              notes: backup.notes,
              nextSeq: backup.manifest.nextSeq,
              appliedOpIds: [],
            }),
          );
          const restored = new Set(backup.images.map((image) => image.id));
          yield* attempt(() =>
            deleteImages(
              env,
              summary.groupId,
              existing.flatMap((image) => (restored.has(image.id) ? [] : [image.id])),
            ),
          );
          return {
            notes: backup.notes.length,
            images: backup.images.length,
            createdAt: backup.manifest.createdAt,
          };
        }),
      ),
);
