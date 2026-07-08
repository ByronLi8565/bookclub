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
  return {
    opId: ulid(),
    kind: "add",
    noteId: ulid(),
    sourceId,
    body,
    highlights,
    createdAt: now(),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

export function addReplyOp(sourceId: string, parent: string, body: string): NoteOp {
  return { opId: ulid(), kind: "reply", noteId: ulid(), sourceId, parent, body, createdAt: now() };
}

export function editNoteOp(noteId: string, body: string): NoteOp {
  return { opId: ulid(), kind: "edit", noteId, body, at: now() };
}

export function removeNoteOp(noteId: string): NoteOp {
  return { opId: ulid(), kind: "remove", noteId, at: now() };
}

export function rebindOp(noteId: string, highlightId: string, anchor: HighlightAnchor): NoteOp {
  return { opId: ulid(), kind: "rebind", noteId, highlightId, anchor };
}
