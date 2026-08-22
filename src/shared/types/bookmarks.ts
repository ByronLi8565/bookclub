import * as Schema from "effect/Schema";
import { SourceReadingPosition } from "./readingPositions.ts";

type SchemaType<S extends Schema.Top> = S["Type"];

export const BookmarkColor = Schema.Literals(["red", "blue", "orange", "purple", "green"]);
export type BookmarkColor = typeof BookmarkColor.Type;

export const BOOKMARK_COLORS: readonly BookmarkColor[] = [
  "red",
  "blue",
  "orange",
  "purple",
  "green",
];

export const StoredBookmark = Schema.Struct({
  groupId: Schema.String,
  sourceId: Schema.String,
  color: BookmarkColor,
  position: SourceReadingPosition,
  updatedAt: Schema.String,
  deletedAt: Schema.NullOr(Schema.String),
});
export interface StoredBookmark extends SchemaType<typeof StoredBookmark> {}

export const BookmarksResponse = Schema.Struct({
  bookmarks: Schema.mutable(Schema.Array(StoredBookmark)),
});

export const SetBookmarkRequest = Schema.Struct({ bookmark: StoredBookmark });
