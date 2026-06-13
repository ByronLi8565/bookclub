import * as Effect from "effect/Effect";
import type { Highlight } from "./types.ts";
import { searchQuote } from "./quote.ts";

// One loaded spine item, presented to the rebind search.
export interface SectionHandle {
  document: Document;
  cfiFromRange(range: Range): string | null;
}

// The epub.js-facing capabilities locate needs, supplied by the reader layer.
export interface SourceReader {
  // Resolve a cfi to a range, or null if it no longer resolves.
  resolveCfi(cfi: string): Effect.Effect<Range | null>;
  // Walk every spine item (loading/unloading each) and return the first
  // Non-null result from `pick`, or null if none match.
  findInSections(pick: (section: SectionHandle) => string | null): Effect.Effect<string | null>;
}

export interface Located {
  cfi: string;
  rebound: boolean;
}

// Primary path: the stored cfi resolves. fallback (rare, "rebinding"): the cfi
// Is stale, so quote-search every spine item and re-derive a fresh cfi.
export const locateHighlight = (
  h: Highlight,
  reader: SourceReader,
): Effect.Effect<Located | null> =>
  Effect.gen(function* () {
    const range = yield* reader.resolveCfi(h.cfi.value);
    if (range) return { cfi: h.cfi.value, rebound: false };

    const fresh = yield* reader.findInSections((section) => {
      const found = searchQuote(section.document, h.quote);
      return found ? section.cfiFromRange(found) : null;
    });

    return fresh ? { cfi: fresh, rebound: true } : null;
  });
