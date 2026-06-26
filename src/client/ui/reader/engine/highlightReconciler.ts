import * as Effect from "effect/Effect";
import type { Highlight, HighlightAnchor, SourceReader } from "../../../logic/notes/highlights.ts";

export interface DesiredHighlight {
  noteId: string | null;
  highlight: Highlight;
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
  const wanted = new Set(desired.map((d) => d.highlight.id));
  for (const [id] of drawn) {
    if (!wanted.has(id)) {
      deps.painter.erase(id);
      drawn.delete(id);
    }
  }

  const missing = desired.filter(({ highlight }) => !drawn.has(highlight.id));
  const locatedHighlights = await Promise.all(
    missing.map(async ({ noteId, highlight }) => {
      if (deps.isCancelled()) return { noteId, highlight, located: null };
      const located = await Effect.runPromise(deps.reader.locateHighlight(highlight));
      return { noteId, highlight, located };
    }),
  );

  for (const { noteId, highlight, located } of locatedHighlights) {
    if (deps.isCancelled()) return;
    if (deps.isCancelled() || !located) continue;
    if (!sameAnchor(located, highlight.anchor) && noteId !== null) {
      deps.rebind(noteId, highlight.id, located);
    }
    deps.painter.draw(highlight.id, located);
    drawn.set(highlight.id, located);
  }
}
