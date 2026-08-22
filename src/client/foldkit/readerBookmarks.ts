import { Effect } from "effect";
import type { BookmarkColor, StoredBookmark } from "../../shared/types/bookmarks.ts";
import type { SourceReadingPosition } from "../../shared/types/readingPositions.ts";
import { bookclubClient } from "../logic/net/bookclubClient.ts";
import {
  getLocalBookmarks,
  restoreBookmarksWith,
  setLocalBookmark,
  syncBookmarksWith,
  type BookmarkTransport,
} from "../logic/settings/bookmarks.ts";

export interface ReaderBookmarks {
  restore: (input: {
    userId: string;
    groupId: string;
    sourceId: string;
  }) => Effect.Effect<StoredBookmark[]>;
  set: (input: {
    userId: string;
    groupId: string;
    sourceId: string;
    color: BookmarkColor;
    position: SourceReadingPosition;
    deleted: boolean;
  }) => Effect.Effect<StoredBookmark[]>;
  sync: (input: {
    userId: string;
    groupId: string;
    sourceId: string;
  }) => Effect.Effect<StoredBookmark[]>;
}

const transport: BookmarkTransport<unknown> = {
  fetch: (groupId, sourceId) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.accounts.bookmarks({ query: { groupId, sourceId } })),
      Effect.map(({ bookmarks }) => bookmarks),
    ),
  push: (bookmark) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.accounts.setBookmark({ payload: { bookmark } })),
      Effect.map(({ bookmarks }) => bookmarks),
    ),
};

export const browserReaderBookmarks: ReaderBookmarks = {
  restore: ({ userId, groupId, sourceId }) =>
    restoreBookmarksWith(transport, userId, groupId, sourceId),
  // Mutations complete from the local cache; the reader's existing sync beat
  // carries them to the account without making a toolbar click wait on radio.
  set: (input) =>
    Effect.sync(() => {
      setLocalBookmark(input);
      return getLocalBookmarks(input.userId, input.groupId, input.sourceId);
    }),
  sync: ({ userId, groupId, sourceId }) => syncBookmarksWith(transport, userId, groupId, sourceId),
};

export const noReaderBookmarks: ReaderBookmarks = {
  restore: () => Effect.succeed([]),
  set: ({ userId, groupId, sourceId, color, position, deleted }) =>
    Effect.sync(() => {
      setLocalBookmark({ userId, groupId, sourceId, color, position, deleted });
      return getLocalBookmarks(userId, groupId, sourceId);
    }),
  sync: () => Effect.succeed([]),
};
