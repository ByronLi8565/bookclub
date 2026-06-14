import * as Effect from "effect/Effect";
import type { Highlight, HighlightAnchor, SourceReader } from "../../notes/highlights.ts";

// A highlight the reader should currently be painting, tagged with the note that
// owns it (or null for the in-flight composing highlight, which has no note and
// so can never be rebound into shared state).
export interface DesiredHighlight {
  noteId: string | null;
  highlight: Highlight;
}

// The reader's paint surface, narrowed to the two calls the reconciler makes.
// Drawing and erasing are keyed by highlight id; the adapter maps the id to
// whatever it needs internally (a cfi, a set of page rects), so the reconciler
// stays anchor-shape-agnostic.
export interface HighlightPainter {
  draw(id: string, anchor: HighlightAnchor): void;
  erase(id: string): void;
}

// True when two anchors point at the same place. Used to decide whether a
// located anchor drifted from the stored one and must be rebound.
function sameAnchor(a: HighlightAnchor, b: HighlightAnchor): boolean {
  if (a.kind === "epub-cfi" && b.kind === "epub-cfi") return a.value === b.value;
  if (a.kind === "pdf-text" && b.kind === "pdf-text") {
    return a.page === b.page && JSON.stringify(a.rects) === JSON.stringify(b.rects);
  }
  return false;
}

// Reconcile what the reader is painting against what it should paint. Draws
// desired highlights that aren't yet drawn (locating them first), erasing the
// rest. `drawn` (highlight id -> the anchor it was painted at) is mutated in
// place.
export async function updateHighlights(
  desired: DesiredHighlight[],
  drawn: Map<string, HighlightAnchor>,
  deps: {
    reader: SourceReader;
    painter: HighlightPainter;
    rebind: (noteId: string, highlightId: string, anchor: HighlightAnchor) => void;
    isCancelled: () => boolean;
  },
): Promise<void> {
  // Erase highlights that have left the desired set.
  const wanted = new Set(desired.map((d) => d.highlight.id));
  for (const [id] of drawn) {
    if (!wanted.has(id)) {
      deps.painter.erase(id);
      drawn.delete(id);
    }
  }

  for (const { noteId, highlight } of desired) {
    if (deps.isCancelled()) return;
    if (drawn.has(highlight.id)) continue;
    const located = await Effect.runPromise(deps.reader.locateHighlight(highlight));
    // State may have changed during the await (e.g. a source switch); drop stale results.
    if (deps.isCancelled() || !located) continue;
    // An anchor that drifted is rebound back into shared state, but only for a
    // real note: the composing highlight (noteId null) isn't in shared state yet.
    if (!sameAnchor(located, highlight.anchor) && noteId !== null) {
      deps.rebind(noteId, highlight.id, located);
    }
    deps.painter.draw(highlight.id, located);
    drawn.set(highlight.id, located);
  }
}
