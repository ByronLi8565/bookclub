import { Effect, type Stream } from "effect";
import { HttpServerResponse, type Multipart } from "effect/unstable/http";
import { uploadedFile } from "./uploads.ts";
import { BadRequest, Conflict, Forbidden, NotFound, TooLarge } from "../../shared/http/errors.ts";
import {
  BOOKCLUB_ARCHIVE_CONTENT_TYPE,
  BOOKCLUB_ARCHIVE_EXTENSION,
  BookclubArchiveError,
  MAX_BOOKCLUB_ARCHIVE_BYTES,
  createBookclubArchive,
  decodeBookclubArchive,
} from "../../shared/backups/bookclubArchive.ts";
import { noteImageIds } from "../../shared/notes/images.ts";
import { GroupAction, permits } from "../../shared/groupPermissions.ts";
import { currentSource, sourceById } from "../../shared/sources.ts";
import { CurrentIdentity } from "../../shared/http/middleware.ts";
import { storeSource } from "../services/sources.ts";
import {
  deleteImages,
  getImage,
  imageKey,
  listImages,
  putImage,
  storeImage,
} from "../services/images.ts";
import { CloudflareEnv } from "./cloudflare.ts";
import { groupCall, io, noteAgent } from "./io.ts";
import { resolveGroup } from "./groupLookup.ts";

type Upload = Stream.Stream<Multipart.Part, Multipart.MultipartError>;

// The upload, image, and backup endpoints of the `groups` contract. They are
// wired alongside the club endpoints in groupHandlers.ts.

const requireAction = Effect.fn("GroupData.requireAction")(function* (
  groupRef: string,
  action: GroupAction,
) {
  const me = yield* CurrentIdentity;
  const resolved = yield* resolveGroup(groupRef);
  const { role } = yield* io(() => resolved.group.membership(me.id));
  if (!role) return yield* new Forbidden({ error: "not_member" });
  if (!permits(role, action)) return yield* new Forbidden({ error: "forbidden" });
  return { ...resolved, me, role };
});

const wordCountHeader = (raw: string | undefined): number | null => {
  const count = raw === undefined ? Number.NaN : Number(raw);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
};

export const uploadBook = Effect.fn("GroupData.uploadBook")(function* (
  groupRef: string,
  headers: {
    readonly "x-source-title"?: string;
    readonly "x-source-author"?: string;
    readonly "x-source-word-count"?: string;
  },
  payload: Upload,
) {
  const env = yield* CloudflareEnv;
  const { group, me } = yield* requireAction(groupRef, GroupAction.UploadBook);
  const upload = yield* uploadedFile(payload);
  const stored = yield* io(() => storeSource(env, upload.bytes, upload.contentType));
  if (!stored.ok) return yield* new BadRequest({ error: stored.reason });
  const source = stored.source;
  yield* groupCall(() =>
    group.addSource(me.id, source.id, {
      kind: source.kind,
      contentType: source.contentType,
      size: source.size,
      title: headers["x-source-title"] || null,
      author: headers["x-source-author"] || null,
      wordCount: wordCountHeader(headers["x-source-word-count"]),
      addedBy: me.id,
    }),
  );
  return { hash: source.id };
});

export const book = Effect.fn("GroupData.book")(function* (groupRef: string, sourceId?: string) {
  const env = yield* CloudflareEnv;
  const { summary } = yield* requireAction(groupRef, GroupAction.ReadBook);
  const source = sourceId ? sourceById(summary, sourceId) : currentSource(summary);
  if (!source) return yield* new NotFound({ error: "no_book" });
  const object = yield* io(() => env.BOOKS.get(source.id));
  if (!object) return yield* new NotFound({ error: "no_book" });
  return HttpServerResponse.raw(object.body, {
    headers: { "content-type": source.contentType, "x-source-id": source.id },
  });
});

export const uploadImage = Effect.fn("GroupData.uploadImage")(function* (
  groupRef: string,
  payload: Upload,
) {
  const env = yield* CloudflareEnv;
  const { summary, me } = yield* requireAction(groupRef, GroupAction.UploadNoteImage);
  const upload = yield* uploadedFile(payload);
  const stored = yield* io(() =>
    storeImage(env, summary.groupId, upload.bytes, upload.contentType, me.id),
  );
  if (!stored.ok) {
    return yield* stored.reason === "too_large"
      ? new TooLarge({ error: stored.reason })
      : new BadRequest({ error: stored.reason });
  }
  return stored.image;
});

export const images = Effect.fn("GroupData.images")(function* (groupRef: string) {
  const env = yield* CloudflareEnv;
  const { group, summary } = yield* requireAction(groupRef, GroupAction.ViewClub);
  const [stored, roster] = yield* Effect.all([
    io(() => listImages(env, summary.groupId)),
    io(() => group.roster()),
  ]);
  const names = new Map(roster.map((member) => [member.id, member.name]));
  return {
    images: stored.map((image) => ({
      ...image,
      uploaderName: (image.uploadedBy && names.get(image.uploadedBy)) || "Unknown member",
    })),
    totalSize: stored.reduce((total, image) => total + image.size, 0),
  };
});

export const deleteImage = Effect.fn("GroupData.deleteImage")(function* (
  groupRef: string,
  imageId: string,
) {
  const env = yield* CloudflareEnv;
  const { summary, me, role } = yield* requireAction(groupRef, GroupAction.UploadNoteImage);
  const object = yield* io(() => env.IMAGES.head(imageKey(summary.groupId, imageId)));
  if (!object) return;
  const notes = yield* noteAgent(summary.groupId);
  if (permits(role, GroupAction.DeleteAnyImage)) {
    yield* io(() => notes.deleteImage(imageId));
    return;
  }
  if (object.customMetadata?.uploadedBy !== me.id) {
    return yield* new Forbidden({ error: "forbidden" });
  }
  if (yield* io(() => notes.referencesImage(imageId))) {
    return yield* new Conflict({ error: "invalid_request" });
  }
  yield* io(() => deleteImages(env, summary.groupId, [imageId]));
});

export const image = Effect.fn("GroupData.image")(function* (groupRef: string, imageId: string) {
  const env = yield* CloudflareEnv;
  const { summary } = yield* requireAction(groupRef, GroupAction.ViewClub);
  const object = yield* io(() => getImage(env, summary.groupId, imageId));
  if (!object) return yield* new NotFound({ error: "not_found" });
  return HttpServerResponse.raw(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "private, max-age=3600",
    },
  });
});

export const exportBackup = Effect.fn("GroupData.exportBackup")(function* (groupRef: string) {
  const env = yield* CloudflareEnv;
  const { summary } = yield* requireAction(groupRef, GroupAction.ManageBackups);
  const notes = yield* noteAgent(summary.groupId);
  const state = yield* io(() => notes.exportState());
  const imageIds = new Set(state.notes.flatMap((note) => [...noteImageIds(note.body)]));
  // A note can outlive an image that was deleted underneath it; the backup
  // keeps every note and simply has no bytes for that image.
  const archived = yield* Effect.forEach([...imageIds], (id) =>
    Effect.gen(function* () {
      const object = yield* io(() => getImage(env, summary.groupId, id));
      if (!object) return [];
      return [
        {
          id,
          contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
          uploadedBy: object.customMetadata?.uploadedBy ?? null,
          bytes: new Uint8Array(yield* io(() => object.arrayBuffer())),
        },
      ];
    }),
  );
  const createdAt = new Date().toISOString();
  const bytes = yield* io(() =>
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
      images: archived.flat(),
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
});

export const restoreBackup = Effect.fn("GroupData.restoreBackup")(function* (
  groupRef: string,
  payload: Upload,
) {
  const env = yield* CloudflareEnv;
  const { summary } = yield* requireAction(groupRef, GroupAction.ManageBackups);
  const upload = yield* uploadedFile(payload);
  const decoded = yield* io(() => decodeBookclubArchive(new Uint8Array(upload.bytes)));
  if (!decoded.ok) {
    return yield* decoded.error === BookclubArchiveError.TooLarge
      ? new TooLarge({ error: "too_large" })
      : new BadRequest({ error: "invalid_backup" });
  }
  const backup = decoded.value;
  if (backup.manifest.club.id !== summary.groupId) {
    return yield* new Conflict({ error: "backup_club_mismatch" });
  }
  const existing = yield* io(() => listImages(env, summary.groupId));
  yield* Effect.forEach(backup.images, (restored) =>
    io(() =>
      putImage(
        env,
        summary.groupId,
        restored.id,
        restored.bytes,
        restored.contentType,
        restored.uploadedBy,
      ),
    ),
  );
  const notes = yield* noteAgent(summary.groupId);
  yield* io(() =>
    notes.importState({ notes: backup.notes, nextSeq: backup.manifest.nextSeq, appliedOpIds: [] }),
  );
  const restoredIds = new Set(backup.images.map((restored) => restored.id));
  yield* io(() =>
    deleteImages(
      env,
      summary.groupId,
      existing.flatMap((stale) => (restoredIds.has(stale.id) ? [] : [stale.id])),
    ),
  );
  return {
    notes: backup.notes.length,
    images: backup.images.length,
    createdAt: backup.manifest.createdAt,
  };
});
