import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { NoteOp } from "../../../shared/types/notes.ts";
import { NoteState } from "../../../shared/notes/noteState.ts";
import { idbGet, idbPut, NOTES_STORE, PersistError } from "../db.ts";

type SchemaType<S extends Schema.Top> = S["Type"];

export const StoredNotes = Schema.Struct({
  userId: Schema.String,
  snapshot: NoteState,
  pendingOps: Schema.mutable(Schema.Array(NoteOp)),
  updatedAt: Schema.String,
});
export interface StoredNotes extends SchemaType<typeof StoredNotes> {}

export const loadNotes = Effect.fn("NotesCache.load")(function* (
  groupId: string,
): Effect.fn.Return<StoredNotes | null, PersistError> {
  const value = yield* idbGet<unknown>(NOTES_STORE, groupId);
  if (value === undefined) return null;
  return yield* Schema.decodeUnknownEffect(StoredNotes)(value).pipe(
    Effect.mapError((cause) => new PersistError({ operation: "NotesCache.decode", cause })),
  );
});

export const saveNotes = Effect.fn("NotesCache.save")(function* (
  groupId: string,
  value: StoredNotes,
): Effect.fn.Return<void, PersistError> {
  yield* idbPut(NOTES_STORE, groupId, value);
});
