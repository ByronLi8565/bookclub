import { useRef, useState, type ReactNode } from "react";

// Two panes with a draggable vertical divider. left width is a percentage.
// A transparent overlay covers the panes while dragging so the epub iframe
// Doesn't swallow pointer events mid-drag.
export function SplitPane({ left, right }: { left: ReactNode; right: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(62);
  const [dragging, setDragging] = useState(false);

  function startDrag() {
    setDragging(true);
    const move = (e: PointerEvent) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const next = ((e.clientX - rect.left) / rect.width) * 100;
      setPct(Math.min(80, Math.max(25, next)));
    };
    const stop = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  return (
    <div className="split" ref={ref}>
      <div className="split-pane" style={{ width: `${pct}%` }}>
        {left}
      </div>
      <div className="split-divider" onPointerDown={startDrag} />
      <div className="split-pane split-pane--grow">{right}</div>
      {dragging && <div className="split-overlay" />}
    </div>
  );
}
