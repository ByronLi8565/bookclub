import { useEffect } from "react";
import type { SourceView } from "./useSourceView.ts";

// Reader shell around the SourceView iframe. `floatingNote` renders the desktop
// "Add Note" popup at the selection; on mobile that affordance lives in the
// pager's bottom bar instead, so it (and its dismiss handler) are disabled here.
export function Reader({
  view,
  hasFile,
  floatingNote = true,
}: {
  view: SourceView;
  hasFile: boolean;
  floatingNote?: boolean;
}) {
  const { fontSize, setFontSize, ready, selection } = view;

  // Dismiss the Add Note popup on any click outside it
  const { dismissSelection } = view;
  useEffect(() => {
    if (!floatingNote || !selection) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".add-note")) dismissSelection();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [floatingNote, selection, dismissSelection]);
  return (
    <div className="reader">
      <div className="reader-bar">
        {view.title && (
          <span className="reader-title" title={view.title}>
            {view.title}
          </span>
        )}
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
            className="reader-page-turn reader-page-turn--prev"
            onClick={view.prev}
            aria-label="Previous page"
          />
        )}
        {ready && !view.location?.atEnd && (
          <button
            className="reader-page-turn reader-page-turn--next"
            onClick={view.next}
            aria-label="Next page"
          />
        )}
      </div>
      {floatingNote && selection && (
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
