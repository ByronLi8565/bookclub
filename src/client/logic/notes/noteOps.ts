import { monotonicFactory } from "ulidx";
import type { Highlight, HighlightAnchor, NoteOp } from "../../../shared/types/notes.ts";

const ulid = monotonicFactory();

const now = (): string => new Date().toISOString();

export function addNoteOp(
  sourceId: string,
  body: string,
  highlights: Highlight[],
  tags: string[] = [],
): NoteOp {
  const op = {
    opId: ulid(),
    kind: "add",
    noteId: ulid(),
    sourceId,
    body,
    highlights,
    createdAt: now(),
  } satisfies Extract<NoteOp, { kind: "add" }>;
  return tags.length > 0 ? { ...op, tags } : op;
}

export function addReplyOp(
  sourceId: string,
  parent: string,
  body: string,
  tags: string[] = [],
): NoteOp {
  const op = {
    opId: ulid(),
    kind: "reply",
    noteId: ulid(),
    sourceId,
    parent,
    body,
    createdAt: now(),
  } satisfies Extract<NoteOp, { kind: "reply" }>;
  return tags.length > 0 ? { ...op, tags } : op;
}

export function updateTagsOp(noteId: string, add: string[], remove: string[]): NoteOp {
  return { opId: ulid(), kind: "update-tags", noteId, add, remove };
}

export function editNoteOp(
  noteId: string,
  body: string,
  addTags: string[] = [],
  removeTags: string[] = [],
): NoteOp {
  const op = { opId: ulid(), kind: "edit", noteId, body, at: now() } satisfies Extract<
    NoteOp,
    { kind: "edit" }
  >;
  if (addTags.length > 0 && removeTags.length > 0) return { ...op, addTags, removeTags };
  if (addTags.length > 0) return { ...op, addTags };
  return removeTags.length > 0 ? { ...op, removeTags } : op;
}

export function removeNoteOp(noteId: string): NoteOp {
  return { opId: ulid(), kind: "remove", noteId, at: now() };
}

export function rebindOp(noteId: string, highlightId: string, anchor: HighlightAnchor): NoteOp {
  return { opId: ulid(), kind: "rebind", noteId, highlightId, anchor };
}
