import * as Effect from "effect/Effect";
import type { Highlight, HighlightAnchor, SourceReader } from "../../../logic/notes/highlights.ts";

export interface DesiredHighlight {
  noteId: string | null;
  highlight: Highlight;
  canRebind: boolean;
}

export interface HighlightPainter {
  draw(id: string, anchor: HighlightAnchor): void;
  erase(id: string): void;
}

function sameAnchor(a: HighlightAnchor, b: HighlightAnchor): boolean {
  if (a.kind === "epub-cfi" && b.kind === "epub-cfi") return a.value === b.value;
  if (a.kind === "pdf-text" && b.kind === "pdf-text") {
    return a.page === b.page && JSON.stringify(a.rects) === JSON.stringify(b.rects);
  }
  return false;
}

export const updateHighlights = Effect.fn("HighlightReconciler.update")(function* (
  desired: DesiredHighlight[],
  drawn: Map<string, HighlightAnchor>,
  deps: {
    reader: SourceReader;
    painter: HighlightPainter;
    rebind: (noteId: string, highlightId: string, anchor: HighlightAnchor) => void;
    isCancelled: () => boolean;
  },
) {
  const wanted = new Set(desired.map((d) => d.highlight.id));
  for (const [id] of drawn) {
    if (!wanted.has(id)) {
      deps.painter.erase(id);
      drawn.delete(id);
    }
  }

  const changed = desired.filter(({ highlight }) => {
    const current = drawn.get(highlight.id);
    return current === undefined || !sameAnchor(current, highlight.anchor);
  });
  for (const { highlight } of changed) {
    if (!drawn.has(highlight.id)) continue;
    deps.painter.erase(highlight.id);
    drawn.delete(highlight.id);
  }
  const locatedHighlights = yield* Effect.forEach(
    changed,
    ({ noteId, highlight, canRebind }) => {
      if (deps.isCancelled()) {
        return Effect.succeed({ noteId, highlight, canRebind, located: null });
      }
      return deps.reader
        .locateHighlight(highlight)
        .pipe(Effect.map((located) => ({ noteId, highlight, canRebind, located })));
    },
    { concurrency: 8 },
  );

  for (const { noteId, highlight, canRebind, located } of locatedHighlights) {
    if (deps.isCancelled()) return;
    if (!located) continue;
    if (!sameAnchor(located, highlight.anchor) && noteId !== null && canRebind) {
      deps.rebind(noteId, highlight.id, located);
    }
    deps.painter.draw(highlight.id, located);
    drawn.set(highlight.id, located);
  }
});
