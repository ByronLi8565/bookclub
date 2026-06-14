import type { Highlight, HighlightAnchor, Note, NoteAuthor } from "../../shared/types/notes.ts";
import { migrateHighlight, needsHighlightMigration } from "../../shared/types/notes.ts";
import { extractReferences } from "../../shared/references.ts";

// The whole synced state for one Source (book): the notes plus the next
// human-readable seq to hand out. Pure transitions over this state live here so
// the note lifecycle can be tested without a durable object; NoteAgent is a thin
// adapter that applies them and broadcasts the result.
export interface NoteState {
  notes: Note[];
  nextSeq: number;
}

// The non-deterministic facts a transition needs, injected so transitions stay
// pure and testable: a fresh sortable id and the current time.
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

// Edit a note's body. Author-only (decision 7): a caller may only edit their own
// note. A mismatch (or a missing/deleted note) is a no-op — the server is the
// enforcer, independent of any UI gating.
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

// Delete a note. A note is only hard-deleted when nothing depends on it: no
// replies and no `[[seq]]` references in any other note. Otherwise it becomes a
// tombstone, so threads stay intact and references never dangle. (No tombstone
// GC: a tombstone is not reclaimed if its last dependent later disappears.)
export function removeNote(
  state: NoteState,
  id: string,
  now: string,
  callerId: string,
  isOwner: boolean,
): NoteState {
  const target = state.notes.find((note) => note.id === id);
  if (!target) return state;
  // Author may delete their own note; the group owner may moderate any note
  // (decision 7). Anyone else is a no-op.
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

// Normalize persisted notes whose highlights predate the anchor model (they
// carried a `cfi` selector instead of `anchor`). Returns the same reference when
// nothing needs migrating, so callers can skip a redundant state write.
export function migrateNoteState(state: NoteState): NoteState {
  const stale = state.notes.some((note) =>
    note.highlights.some((h) => needsHighlightMigration(h as never)),
  );
  if (!stale) return state;
  return {
    ...state,
    notes: state.notes.map((note) => ({
      ...note,
      highlights: note.highlights.map((h) => migrateHighlight(h as never)),
    })),
  };
}

// Replace the note list while preserving the seq counter.
function setNotes(state: NoteState, notes: Note[]): NoteState {
  return { notes, nextSeq: state.nextSeq ?? 1 };
}

// Append a new note (top-level or reply) with the server-authored fields stamped.
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
