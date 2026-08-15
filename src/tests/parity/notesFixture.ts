import type { Highlight, Note } from "../../shared/types/notes.ts";

export const highlight: Highlight = {
  id: "highlight-1",
  sourceId: "source-1",
  anchor: { kind: "epub-cfi", value: "epubcfi(/6/2)" },
  quote: { type: "TextQuoteSelector", exact: "a marked passage", prefix: "", suffix: "" },
  createdAt: "2026-08-15T00:00:00.000Z",
};

export const rootNote: Note = {
  id: "note-1",
  seq: 1,
  sourceId: "source-1",
  author: { id: "reader-1", name: "Reader One" },
  parent: null,
  body: "the first note",
  highlights: [highlight],
  tags: ["theme"],
  createdAt: "2026-08-15T00:00:00.000Z",
  editedAt: null,
  deletedAt: null,
  version: 1,
};

export const replyNote: Note = {
  ...rootNote,
  id: "note-2",
  seq: 2,
  author: { id: "reader-2", name: "Reader Two" },
  parent: rootNote.id,
  body: "a reply",
  highlights: [],
  tags: [],
  createdAt: "2026-08-15T00:01:00.000Z",
};

export const notes: Note[] = [rootNote, replyNote];

export const viewer = { userId: rootNote.author.id, isOwner: false };

export const avatarFor = (author: { id: string; name: string }) => ({
  url: null,
  initials: author.name.slice(0, 1),
  name: author.name,
});
