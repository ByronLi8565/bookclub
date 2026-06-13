import type { SourceView } from "./useSourceView.ts";

// Presentational shell: the painting surface, navigation, and the font-size
// Control that triggers reflow.
export function Reader({ view, hasFile }: { view: SourceView; hasFile: boolean }) {
  const { fontSize, setFontSize } = view;
  return (
    <div className="reader">
      <div className="reader-bar">
        <button onClick={view.prev} disabled={!hasFile}>
          ← prev
        </button>
        <button onClick={view.next} disabled={!hasFile}>
          next →
        </button>
        <span className="spacer" />
        <button onClick={() => setFontSize(Math.max(50, fontSize - 25))} disabled={!hasFile}>
          A−
        </button>
        <span className="font-size">{fontSize}%</span>
        <button onClick={() => setFontSize(fontSize + 25)} disabled={!hasFile}>
          A+
        </button>
      </div>
      <div className="reader-surface" ref={view.containerRef}>
        {!hasFile && <p className="reader-empty">Open an EPUB to begin.</p>}
      </div>
    </div>
  );
}
