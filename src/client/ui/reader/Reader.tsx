import { useEffect } from "react";
import type { SourceView } from "./useSourceView.ts";

// Reader shell around the SourceView iframe
export function Reader({ view, hasFile }: { view: SourceView; hasFile: boolean }) {
  const { fontSize, setFontSize, ready, selection } = view;

  // Dismiss the Add Note popup on any click outside it
  const { dismissSelection } = view;
  useEffect(() => {
    if (!selection) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".add-note")) dismissSelection();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [selection, dismissSelection]);
  return (
    <div className="reader">
      <div className="reader-bar">
        {view.location && (
          <span className="page-count">
            {view.location.page} / {view.location.total}
            {view.location.percentage > 0 && ` · ${Math.round(view.location.percentage * 100)}%`}
          </span>
        )}
        <span className="spacer" />
        <button onClick={() => setFontSize(Math.max(80, fontSize - 10))} disabled={!ready}>
          −
        </button>
        <span className="font-size">{fontSize}%</span>
        <button onClick={() => setFontSize(fontSize + 10)} disabled={!ready}>
          +
        </button>
      </div>
      <div className="reader-stage">
        <div className="reader-surface" ref={view.containerRef}>
          {!hasFile && <p className="reader-empty">Open an EPUB to begin.</p>}
        </div>
        {ready && !view.location?.atStart && (
          <button
            className="reader-arrow reader-arrow--prev"
            onClick={view.prev}
            aria-label="Previous page"
          >
            ‹
          </button>
        )}
        {ready && !view.location?.atEnd && (
          <button
            className="reader-arrow reader-arrow--next"
            onClick={view.next}
            aria-label="Next page"
          >
            ›
          </button>
        )}
      </div>
      {selection && (
        <button
          className="add-note"
          style={{ left: selection.x, top: selection.y }}
          onClick={view.commitSelection}
        >
          Add Note
        </button>
      )}
    </div>
  );
}
