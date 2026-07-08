import * as Effect from "effect/Effect";
import type { NoteOp } from "../../../shared/types/notes.ts";
import type { NoteState } from "../../../shared/notes/noteState.ts";
import { idbGet, idbPut, NOTES_STORE, type PersistError } from "../db.ts";

export interface StoredNotes {
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
