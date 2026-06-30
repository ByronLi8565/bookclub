import * as Effect from "effect/Effect";
import type { NoteOp } from "../../../shared/types/notes.ts";
import type { NoteState } from "../../../shared/notes/noteState.ts";
import { idbGet, idbPut, NOTES_STORE, type PersistError } from "../db.ts";

// One durable record per group: the last authoritative server snapshot plus the
// ordered queue of unsynced local ops. Snapshot and queue are written together
// (single key, single transaction) so a crash can never leave the queue
// inconsistent with the snapshot it was rebased onto.
export interface StoredNotes {
  // Identity the queue was authored under. On hydrate we refuse to flush a queue
  // belonging to a different user, so ops can never be misattributed after a
  // sign-out/sign-in.
  userId: string;
  snapshot: NoteState;
  pendingOps: NoteOp[];
  updatedAt: string;
}

export function loadNotes(groupId: string): Effect.Effect<StoredNotes | null, PersistError> {
  return idbGet<StoredNotes>(NOTES_STORE, groupId).pipe(Effect.map((v) => v ?? null));
}

export function saveNotes(groupId: string, value: StoredNotes): Effect.Effect<void, PersistError> {
  return idbPut(NOTES_STORE, groupId, value);
}
