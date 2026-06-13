import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Card } from "../cards/types.ts";
import { StorageError } from "../errors.ts";
import { getDb } from "./db.ts";

interface CardStoreShape {
  list(sourceId: string): Effect.Effect<Card[], StorageError>;
  save(card: Card): Effect.Effect<void, StorageError>;
  remove(id: string): Effect.Effect<void, StorageError>;
  // Rebind a single embedded highlight's cfi after a locate.
  updateHighlightCfi(
    cardId: string,
    highlightId: string,
    value: string,
  ): Effect.Effect<void, StorageError>;
}

export class CardStore extends Context.Service<CardStore, CardStoreShape>()("CardStore") {}

export const CardStoreLive = Layer.effect(
  CardStore,
  Effect.gen(function* () {
    const db = yield* Effect.promise(() => getDb());
    const run = <A>(thunk: () => Promise<A>) =>
      Effect.tryPromise({ try: thunk, catch: (cause) => new StorageError({ cause }) });

    return {
      list: (sourceId) =>
        run(() => db.getAllFromIndex("cards", "by-source", sourceId)).pipe(
          Effect.map((all) => all.sort((a, b) => a.createdAt.localeCompare(b.createdAt))),
        ),
      save: (card) => run(() => db.put("cards", card)).pipe(Effect.asVoid),
      remove: (id) => run(() => db.delete("cards", id)).pipe(Effect.asVoid),
      updateHighlightCfi: (cardId, highlightId, value) =>
        run(async () => {
          const card = await db.get("cards", cardId);
          if (!card) return;
          const highlights = card.highlights.map((h) =>
            h.id === highlightId ? { ...h, cfi: { ...h.cfi, value } } : h,
          );
          await db.put("cards", { ...card, highlights });
        }).pipe(Effect.asVoid),
    };
  }),
);
