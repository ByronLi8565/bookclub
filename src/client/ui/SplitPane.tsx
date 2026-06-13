import { useRef, useState, type ReactNode } from "react";

// Two panes with a draggable vertical divider. left width is a percentage.
export function SplitPane({ left, right }: { left: ReactNode; right: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(62);

  function startDrag() {
    const move = (e: PointerEvent) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const next = ((e.clientX - rect.left) / rect.width) * 100;
      setPct(Math.min(80, Math.max(25, next)));
    };
    const stop = () => {
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
    </div>
  );
}
