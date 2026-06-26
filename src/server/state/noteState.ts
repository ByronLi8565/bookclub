import type { Highlight, HighlightAnchor, Note, NoteAuthor } from "../../shared/types/notes.ts";
import { extractReferences } from "../../shared/references.ts";

export interface NoteState {
  notes: Note[];
  nextSeq: number;
}

export interface NoteStamp {
  id(): string;
  now(): string;
}

export function emptyNoteState(): NoteState {
  return { notes: [], nextSeq: 1 };
}

export function addNote(
  state: NoteState,
  sourceId: string,
  author: NoteAuthor,
  body: string,
  highlights: Highlight[],
  stamp: NoteStamp,
): NoteState {
  return append(state, sourceId, author, null, body, highlights, stamp);
}

export function addReply(
  state: NoteState,
  sourceId: string,
  author: NoteAuthor,
  parent: string,
  body: string,
  stamp: NoteStamp,
): NoteState {
  return append(state, sourceId, author, parent, body, [], stamp);
}

export function editNote(
  state: NoteState,
  id: string,
  body: string,
  now: string,
  callerId: string,
): NoteState {
  return setNotes(
    state,
    state.notes.map((note) =>
      note.id === id && note.deletedAt === null && note.author.id === callerId
        ? { ...note, body, editedAt: now, version: note.version + 1 }
        : note,
    ),
  );
}

export function removeNote(
  state: NoteState,
  id: string,
  now: string,
  callerId: string,
  isOwner: boolean,
): NoteState {
  const target = state.notes.find((note) => note.id === id);
  if (!target) return state;
  if (target.author.id !== callerId && !isOwner) return state;

  const hasChildren = state.notes.some((note) => note.parent === id);
  const isReferenced = state.notes.some(
    (note) => note.id !== id && extractReferences(note.body).includes(target.seq),
  );
  if (!hasChildren && !isReferenced) {
    return setNotes(
      state,
      state.notes.filter((note) => note.id !== id),
    );
  }

  const deletedAtLabel = new Date(now).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return setNotes(
    state,
    state.notes.map((note) =>
      note.id === id
        ? {
            ...note,
            body: `*This note was deleted on ${deletedAtLabel}*`,
            highlights: [],
            editedAt: now,
            deletedAt: now,
            version: note.version + 1,
          }
        : note,
    ),
  );
}

export function rebindHighlight(
  state: NoteState,
  noteId: string,
  highlightId: string,
  anchor: HighlightAnchor,
): NoteState {
  return setNotes(
    state,
    state.notes.map((note) =>
      note.id === noteId
        ? {
            ...note,
            highlights: note.highlights.map((h) => (h.id === highlightId ? { ...h, anchor } : h)),
          }
        : note,
    ),
  );
}

function setNotes(state: NoteState, notes: Note[]): NoteState {
  return { notes, nextSeq: state.nextSeq ?? 1 };
}

function append(
  state: NoteState,
  sourceId: string,
  author: NoteAuthor,
  parent: string | null,
  body: string,
  highlights: Highlight[],
  stamp: NoteStamp,
): NoteState {
  const seq = state.nextSeq ?? 1;
  const note: Note = {
    id: stamp.id(),
    seq,
    sourceId,
    author,
    parent,
    body,
    highlights,
    createdAt: stamp.now(),
    editedAt: null,
    deletedAt: null,
    version: 1,
  };
  return { notes: [...state.notes, note], nextSeq: seq + 1 };
}
