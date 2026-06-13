import * as Effect from "effect/Effect";
import type { Highlight } from "./types.ts";
import { searchQuote } from "./quote.ts";

// One loaded spine item, presented to the rebind search.
export interface SectionHandle {
  document: Document;
  cfiFromRange(range: Range): string | null;
}

// Epub.js-facing capabilities needed by locate.
export interface SourceReader {
  resolveCfi(cfi: string): Effect.Effect<Range | null>;
  findInSections(pick: (section: SectionHandle) => string | null): Effect.Effect<string | null>;
}

export interface HighlightLocation {
  cfi: string;
}

export const locateHighlight = (
  h: Highlight,
  reader: SourceReader,
): Effect.Effect<HighlightLocation | null> =>
  Effect.gen(function* () {
    const range = yield* reader.resolveCfi(h.cfi.value);
    if (range) return { cfi: h.cfi.value };

    const fresh = yield* reader.findInSections((section) => {
      const found = searchQuote(section.document, h.quote);
      return found ? section.cfiFromRange(found) : null;
    });

    return fresh ? { cfi: fresh } : null;
  });
