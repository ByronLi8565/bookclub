import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { StorageError } from "../errors.ts";
import type { Highlight } from "../highlights/types.ts";
import { getDb } from "./db.ts";

interface HighlightStoreShape {
  list(sourceId: string): Effect.Effect<Highlight[], StorageError>;
  save(h: Highlight): Effect.Effect<void, StorageError>;
  remove(id: string): Effect.Effect<void, StorageError>;
  updateCfi(id: string, value: string): Effect.Effect<void, StorageError>;
}

export class HighlightStore extends Context.Service<HighlightStore, HighlightStoreShape>()(
  "HighlightStore",
) {}

export const HighlightStoreLive = Layer.effect(
  HighlightStore,
  Effect.gen(function* () {
    const db = yield* Effect.promise(() => getDb());
    const run = <A>(thunk: () => Promise<A>) =>
      Effect.tryPromise({ try: thunk, catch: (cause) => new StorageError({ cause }) });

    return {
      list: (sourceId) =>
        run(() => db.getAllFromIndex("highlights", "by-source", sourceId)).pipe(
          Effect.map((all) => all.sort((a, b) => a.createdAt.localeCompare(b.createdAt))),
        ),
      save: (h) => run(() => db.put("highlights", h)).pipe(Effect.asVoid),
      remove: (id) => run(() => db.delete("highlights", id)).pipe(Effect.asVoid),
      updateCfi: (id, value) =>
        run(async () => {
          const h = await db.get("highlights", id);
          if (h) await db.put("highlights", { ...h, cfi: { ...h.cfi, value } });
        }).pipe(Effect.asVoid),
    };
  }),
);
