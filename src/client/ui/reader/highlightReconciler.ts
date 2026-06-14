import * as Effect from "effect/Effect";
import { locateHighlight, type Highlight, type SourceReader } from "../../highlights.ts";

// A highlight the rendition should currently be painting, tagged with the note
// that owns it (or null for the in-flight composing highlight, which has no note
// and so can never be rebound into shared state).
export interface DesiredHighlight {
  noteId: string | null;
  highlight: Highlight;
}

// The rendition's paint surface, narrowed to the two calls the reconciler makes.
export interface HighlightPainter {
  draw(id: string, cfi: string): void;
  erase(cfi: string): void;
}

// Reconcile what the rendition is painting against what it should paint. Draws
// desired highlights that aren't yet drawn (locating them first), erasing the
// rest. `drawn` (highlight id -> the cfi it was painted at) is mutated in place.
export async function updateHighlights(
  desired: DesiredHighlight[],
  drawn: Map<string, string>,
  deps: {
    reader: SourceReader;
    painter: HighlightPainter;
    rebind: (noteId: string, highlightId: string, cfi: string) => void;
    isCancelled: () => boolean;
  },
): Promise<void> {
  for (const { highlight } of desired) {
    const located = await Effect.runPromise(locateHighlight(highlight, deps.reader));
    if (!located) continue;
    deps.painter.draw(highlight.id, located.cfi);
    drawn.set(highlight.id, located.cfi);
  }
}
