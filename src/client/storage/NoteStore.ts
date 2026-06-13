import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Note } from "../notes.ts";
import { StorageError } from "../errors.ts";
import { getDb } from "./db.ts";

interface NoteStoreShape {
  list(sourceId: string): Effect.Effect<Note[], StorageError>;
  save(note: Note): Effect.Effect<void, StorageError>;
  remove(id: string): Effect.Effect<void, StorageError>;
  // Rebind a single embedded highlight's cfi after a locate.
  updateHighlightCfi(
    noteId: string,
    highlightId: string,
    value: string,
  ): Effect.Effect<void, StorageError>;
}

export class NoteStore extends Context.Service<NoteStore, NoteStoreShape>()("NoteStore") {}

export const NoteStoreLive = Layer.effect(
  NoteStore,
  Effect.gen(function* () {
    const db = yield* Effect.promise(() => getDb());
    const run = <A>(thunk: () => Promise<A>) =>
      Effect.tryPromise({ try: thunk, catch: (cause) => new StorageError({ cause }) });

    return {
      list: (sourceId) =>
        run(() => db.getAllFromIndex("notes", "by-source", sourceId)).pipe(
          Effect.map((all) => all.sort((a, b) => a.createdAt.localeCompare(b.createdAt))),
        ),
      save: (note) => run(() => db.put("notes", note)).pipe(Effect.asVoid),
      remove: (id) => run(() => db.delete("notes", id)).pipe(Effect.asVoid),
      updateHighlightCfi: (noteId, highlightId, value) =>
        run(async () => {
          const note = await db.get("notes", noteId);
          if (!note) return;
          const highlights = note.highlights.map((h) =>
            h.id === highlightId ? { ...h, cfi: { ...h.cfi, value } } : h,
          );
          await db.put("notes", { ...note, highlights });
        }).pipe(Effect.asVoid),
    };
  }),
);
