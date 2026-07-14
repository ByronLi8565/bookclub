import { useRef, useState, type ReactNode } from "react";
import type { ExpandedPane } from "../workspace/visibility.ts";

const MIN_PCT = 25;
const MAX_PCT = 80;

function paneClassName(base: string, hidden: boolean): string {
  return hidden ? `${base} split-pane--hidden` : base;
}

export function SplitPane({
  left,
  right,
  expandedPane = null,
  onExpandedPaneChange,
}: {
  left: ReactNode;
  right: ReactNode;
  expandedPane?: ExpandedPane;
  onExpandedPaneChange?: (pane: ExpandedPane) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(62);
  const [dragging, setDragging] = useState(false);
  const visiblePct = expandedPane === "left" ? 100 : expandedPane === "right" ? 0 : pct;
  const hideLeft = !dragging && expandedPane === "right";
  const hideRight = !dragging && expandedPane === "left";
  const expandedClass = expandedPane === null ? "" : ` split--expanded-${expandedPane}`;

  function startDrag() {
    setDragging(true);
    let latest = visiblePct;
    const move = (e: PointerEvent) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const next = ((e.clientX - rect.left) / rect.width) * 100;
      latest = Math.min(100, Math.max(0, next));
      // Drive the width straight on the DOM during the drag so we don't
      // reconcile the (heavy) reader subtree on every pointer move. The
      // ResizeObserver in the reader still tracks the live width.
      if (paneRef.current) paneRef.current.style.width = `${latest}%`;
    };
    const stop = () => {
      setDragging(false);
      if (latest <= MIN_PCT) {
        onExpandedPaneChange?.("right");
      } else if (latest >= MAX_PCT) {
        onExpandedPaneChange?.("left");
      } else {
        onExpandedPaneChange?.(null);
        // Commit the final width to React state once, on release.
        setPct(latest);
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  return (
    <div className={`${dragging ? "split is-dragging" : "split"}${expandedClass}`} ref={ref}>
      <div
        className={paneClassName("split-pane", hideLeft)}
        ref={paneRef}
        style={{ width: `${visiblePct}%` }}
        aria-hidden={hideLeft}
      >
        {left}
      </div>
      <div className="split-divider" onPointerDown={startDrag} />
      <div
        className={paneClassName("split-pane split-pane--grow", hideRight)}
        aria-hidden={hideRight}
      >
        {right}
      </div>
      {dragging && <div className="split-overlay" />}
    </div>
  );
}
