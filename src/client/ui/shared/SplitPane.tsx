import { useRef, useState, type ReactNode } from "react";

const MIN_PCT = 25;
const MAX_PCT = 80;

export function SplitPane({ left, right }: { left: ReactNode; right: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(62);
  const [dragging, setDragging] = useState(false);

  function startDrag() {
    setDragging(true);
    let latest = pct;
    const move = (e: PointerEvent) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const next = ((e.clientX - rect.left) / rect.width) * 100;
      latest = Math.min(MAX_PCT, Math.max(MIN_PCT, next));
      // Drive the width straight on the DOM during the drag so we don't
      // reconcile the (heavy) reader subtree on every pointer move. The
      // ResizeObserver in the reader still tracks the live width.
      if (paneRef.current) paneRef.current.style.width = `${latest}%`;
    };
    const stop = () => {
      setDragging(false);
      // Commit the final width to React state once, on release.
      setPct(latest);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  return (
    <div className="split" ref={ref}>
      <div className="split-pane" ref={paneRef} style={{ width: `${pct}%` }}>
        {left}
      </div>
      <div className="split-divider" onPointerDown={startDrag} />
      <div className="split-pane split-pane--grow">{right}</div>
      {dragging && <div className="split-overlay" />}
    </div>
  );
}
