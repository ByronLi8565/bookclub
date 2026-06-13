import * as Effect from "effect/Effect";
import { cfiSelector, type Highlight } from "./types.ts";
import { deriveQuote } from "./quote.ts";

// Turn a selection (cfi + live range) into a Highlight. the id is a local
// Placeholder; the server assigns the canonical ulid in a later step.
export const captureHighlight = (
  sourceId: string,
  cfi: string,
  range: Range,
): Effect.Effect<Highlight> =>
  Effect.sync(() => ({
    id: crypto.randomUUID(),
    sourceId,
    cfi: cfiSelector(cfi),
    quote: deriveQuote(range),
    createdAt: new Date().toISOString(),
  }));
