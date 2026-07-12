import type {
  ApplyOpsResult,
  Highlight,
  HighlightAnchor,
  Note,
  NoteAuthor,
  NoteOp,
  RejectedOp,
} from "../types/notes.ts";
import { NoteRejectionReason } from "../types/notes.ts";
import { extractReferences } from "../references.ts";

export interface NoteState {
  notes: Note[];
  nextSeq: number;
  // R2 cleanup is retried with the originating local-first operation if the
  // object store is temporarily unavailable.
  pendingImageDeletes?: string[];
  // Bounded ring of op ids the server has already applied. This is *defense in
  // depth* for idempotent replay — the primary guarantee comes from structural
  // checks (a note id that already exists is never re-added; edits are gated by
  // last-write-wins timestamps). Because it is only a safety net, its retention
  // bound can never cause data loss or duplication.
  appliedOpIds?: string[];
}

export interface NoteStamp {
  id(): string;
  now(): string;
}

// How many recently-applied op ids to retain. Generous enough to cover any
// realistic offline window; correctness does not depend on this number.
const APPLIED_OP_RING = 2000;

export function emptyNoteState(): NoteState {
  return { notes: [], nextSeq: 1, appliedOpIds: [] };
}

export function addNote(
  state: NoteState,
  sourceId: string,
  author: NoteAuthor,
  body: string,
  highlights: Highlight[],
  stamp: NoteStamp,
  tags: string[] = [],
): NoteState {
  return append(state, stamp.id(), sourceId, author, null, body, highlights, stamp.now(), tags);
}

export function addReply(
  state: NoteState,
  sourceId: string,
  author: NoteAuthor,
  parent: string,
  body: string,
  stamp: NoteStamp,
): NoteState {
  return append(state, stamp.id(), sourceId, author, parent, body, [], stamp.now(), []);
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

export function removeSourceNotes(state: NoteState, sourceId: string): NoteState {
  return { ...state, notes: state.notes.filter((note) => note.sourceId !== sourceId) };
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
  return { notes, nextSeq: state.nextSeq ?? 1, appliedOpIds: state.appliedOpIds ?? [] };
}

function append(
  state: NoteState,
  id: string,
  sourceId: string,
  author: NoteAuthor,
  parent: string | null,
  body: string,
  highlights: Highlight[],
  createdAt: string,
  tags: string[],
): NoteState {
  const seq = state.nextSeq ?? 1;
  const note: Note = {
    id,
    seq,
    sourceId,
    author,
    parent,
    body,
    highlights,
    createdAt,
    editedAt: null,
    deletedAt: null,
    version: 1,
    // Only carry the field when there's something to say, so untagged notes
    // stay byte-for-byte identical to their pre-tags shape.
    ...(tags.length > 0 ? { tags } : {}),
  };
  return {
    notes: [...state.notes, note],
    nextSeq: seq + 1,
    appliedOpIds: state.appliedOpIds ?? [],
  };
}

export interface ApplyContext {
  author: NoteAuthor;
  isOwner: boolean;
}

type OpOutcome =
  | { kind: "applied"; state: NoteState }
  | { kind: "noop" } // idempotent / superseded: prune on the client, no change
  | { kind: "rejected"; reason: RejectedOp["reason"] };

// Apply a single op against state. Pure and total — never throws. The returned
// outcome tells the caller whether the op changed state, was a safe no-op
// (already applied / superseded by a newer write), or must be reported back to
// its author as rejected (lost-on-conflict or unauthorized).
function applyOp(state: NoteState, op: NoteOp, ctx: ApplyContext): OpOutcome {
  switch (op.kind) {
    case "add":
    case "reply": {
      // Structural idempotency: a stable client-generated id means a replayed
      // add is recognised and skipped, so retries never duplicate a note and
      // never consume a fresh seq.
      if (state.notes.some((n) => n.id === op.noteId)) return { kind: "noop" };
      const parent = op.kind === "reply" ? op.parent : null;
      return {
        kind: "applied",
        state: append(
          state,
          op.noteId,
          op.sourceId,
          ctx.author,
          parent,
          op.body,
          op.kind === "add" ? op.highlights : [],
          op.createdAt,
          op.kind === "add" ? (op.tags ?? []) : [],
        ),
      };
    }
    case "edit": {
      const note = state.notes.find((n) => n.id === op.noteId);
      if (!note) return { kind: "rejected", reason: NoteRejectionReason.Gone };
      if (note.deletedAt !== null) return { kind: "rejected", reason: NoteRejectionReason.Gone };
      if (note.author.id !== ctx.author.id) {
        return { kind: "rejected", reason: NoteRejectionReason.Forbidden };
      }
      // Last-write-wins: an edit older than the note's current revision is
      // silently superseded (a no-op to prune), never an error.
      const current = note.editedAt ?? note.createdAt;
      if (op.at <= current) return { kind: "noop" };
      return { kind: "applied", state: editNote(state, op.noteId, op.body, op.at, ctx.author.id) };
    }
    case "remove": {
      const note = state.notes.find((n) => n.id === op.noteId);
      if (!note) return { kind: "noop" }; // already gone
      if (note.author.id !== ctx.author.id && !ctx.isOwner) {
        return { kind: "rejected", reason: NoteRejectionReason.Forbidden };
      }
      return {
        kind: "applied",
        state: removeNote(state, op.noteId, op.at, ctx.author.id, ctx.isOwner),
      };
    }
    case "rebind": {
      const note = state.notes.find((n) => n.id === op.noteId);
      if (!note || !note.highlights.some((h) => h.id === op.highlightId)) return { kind: "noop" };
      if (note.author.id !== ctx.author.id && !ctx.isOwner) {
        return { kind: "rejected", reason: NoteRejectionReason.Forbidden };
      }
      return {
        kind: "applied",
        state: rebindHighlight(state, op.noteId, op.highlightId, op.anchor),
      };
    }
  }
}

function rememberOp(state: NoteState, opId: string): NoteState {
  const ring = state.appliedOpIds ?? [];
  const next = ring.includes(opId) ? ring : [...ring, opId];
  return {
    ...state,
    appliedOpIds: next.length > APPLIED_OP_RING ? next.slice(next.length - APPLIED_OP_RING) : next,
  };
}

// Fold a batch of ops into state in order, idempotently. Returns the new state
// plus the per-op disposition. Ops already present in the applied-op ring, or
// that resolve to a safe no-op, are reported as applied so the client prunes
// them from its pending queue; only genuine conflicts/authz failures are
// rejected and surfaced to the author.
export function applyOperations(
  state: NoteState,
  ops: readonly NoteOp[],
  ctx: ApplyContext,
): { state: NoteState } & ApplyOpsResult {
  let next: NoteState = { ...state, appliedOpIds: state.appliedOpIds ?? [] };
  const appliedOpIds: string[] = [];
  const rejectedOps: RejectedOp[] = [];

  for (const op of ops) {
    if ((next.appliedOpIds ?? []).includes(op.opId)) {
      appliedOpIds.push(op.opId);
      continue;
    }
    const outcome = applyOp(next, op, ctx);
    if (outcome.kind === "rejected") {
      rejectedOps.push({ opId: op.opId, reason: outcome.reason });
      continue;
    }
    if (outcome.kind === "applied") next = outcome.state;
    next = rememberOp(next, op.opId);
    appliedOpIds.push(op.opId);
  }

  return { state: next, appliedOpIds, rejectedOps };
}
