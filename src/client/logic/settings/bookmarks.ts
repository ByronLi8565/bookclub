import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { decode } from "../../../shared/schema.ts";
import {
  StoredBookmark,
  type BookmarkColor,
  type StoredBookmark as StoredBookmarkType,
} from "../../../shared/types/bookmarks.ts";
import type { SourceReadingPosition } from "../../../shared/types/readingPositions.ts";
import { readLocal, writeLocal } from "../storage.ts";

const STORAGE_KEY = "bookclub.bookmarks:v1";
const BookmarkCache = Schema.Record(Schema.String, Schema.mutable(Schema.Array(StoredBookmark)));

const keyFor = (userId: string, groupId: string, sourceId: string): string =>
  `${userId}:${groupId}:${sourceId}`;

const loadAll = (): Record<string, StoredBookmarkType[]> =>
  decode(BookmarkCache, readLocal<unknown>(STORAGE_KEY)) ?? {};

const saveAll = (bookmarks: Record<string, StoredBookmarkType[]>): void =>
  writeLocal(STORAGE_KEY, bookmarks);

export function getLocalBookmarks(
  userId: string,
  groupId: string,
  sourceId: string,
): StoredBookmarkType[] {
  return loadAll()[keyFor(userId, groupId, sourceId)] ?? [];
}

function saveLocalBookmarks(
  userId: string,
  groupId: string,
  sourceId: string,
  bookmarks: StoredBookmarkType[],
): StoredBookmarkType[] {
  const all = loadAll();
  all[keyFor(userId, groupId, sourceId)] = bookmarks;
  saveAll(all);
  return bookmarks;
}

function newer(a: StoredBookmarkType, b: StoredBookmarkType): StoredBookmarkType {
  return Date.parse(a.updatedAt) >= Date.parse(b.updatedAt) ? a : b;
}

export function mergeBookmarks(
  userId: string,
  groupId: string,
  sourceId: string,
  incoming: readonly StoredBookmarkType[],
): StoredBookmarkType[] {
  const byColor = new Map<BookmarkColor, StoredBookmarkType>();
  for (const bookmark of [...getLocalBookmarks(userId, groupId, sourceId), ...incoming]) {
    const current = byColor.get(bookmark.color);
    byColor.set(bookmark.color, current === undefined ? bookmark : newer(bookmark, current));
  }
  return saveLocalBookmarks(userId, groupId, sourceId, [...byColor.values()]);
}

export function setLocalBookmark(input: {
  userId: string;
  groupId: string;
  sourceId: string;
  color: BookmarkColor;
  position: SourceReadingPosition;
  deleted: boolean;
}): StoredBookmarkType {
  const now = new Date().toISOString();
  const bookmark: StoredBookmarkType = {
    groupId: input.groupId,
    sourceId: input.sourceId,
    color: input.color,
    position: input.position,
    updatedAt: now,
    deletedAt: input.deleted ? now : null,
  };
  mergeBookmarks(input.userId, input.groupId, input.sourceId, [bookmark]);
  return bookmark;
}

export interface BookmarkTransport<E> {
  fetch: (groupId: string, sourceId: string) => Effect.Effect<StoredBookmarkType[], E>;
  push: (bookmark: StoredBookmarkType) => Effect.Effect<StoredBookmarkType[], E>;
}

export const restoreBookmarksWith = Effect.fn("Bookmarks.restoreWith")(function* <E>(
  transport: BookmarkTransport<E>,
  userId: string,
  groupId: string,
  sourceId: string,
): Effect.fn.Return<StoredBookmarkType[], never> {
  const local = getLocalBookmarks(userId, groupId, sourceId);
  return yield* transport.fetch(groupId, sourceId).pipe(
    Effect.map((remote) => mergeBookmarks(userId, groupId, sourceId, remote)),
    Effect.orElseSucceed(() => local),
  );
});

export const syncBookmarksWith = Effect.fn("Bookmarks.syncWith")(function* <E>(
  transport: BookmarkTransport<E>,
  userId: string,
  groupId: string,
  sourceId: string,
): Effect.fn.Return<StoredBookmarkType[], never> {
  const local = getLocalBookmarks(userId, groupId, sourceId);
  yield* Effect.forEach(
    local,
    (bookmark) =>
      transport.push(bookmark).pipe(
        Effect.tap((remote) =>
          Effect.sync(() => mergeBookmarks(userId, groupId, sourceId, remote)),
        ),
        Effect.orElseSucceed(() => []),
      ),
    { concurrency: 1, discard: true },
  );
  return getLocalBookmarks(userId, groupId, sourceId);
});
