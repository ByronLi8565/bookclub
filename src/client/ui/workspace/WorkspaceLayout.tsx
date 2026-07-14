import { useRef, useState, type ReactNode } from "react";
import { useSwipeable } from "react-swipeable";
import type { Pane } from "../shared/MobilePager.tsx";
import type { ExpandedPane } from "./visibility.ts";

const MIN_PCT = 25;
const MAX_PCT = 80;
const PANE_SWIPE_DELTA_PX = 50;
const CHROME_SWIPE_DELTA_PX = 80;
const PANE_SWIPE_DURATION_MS = 500;

export type WorkspaceLayoutMode =
  | {
      kind: "desktop";
      expandedPane: ExpandedPane;
      onExpandedPaneChange: (pane: ExpandedPane) => void;
    }
  | {
      kind: "mobile";
      pane: Pane;
      onPane: (pane: Pane) => void;
      selecting: boolean;
      onAddNote: () => void;
      onHighlight: () => void;
      onChromeHiddenChange: (hidden: boolean) => void;
    };

function startedOnHorizontalScroller(target: EventTarget | null): boolean {
  let element = target instanceof Element ? target : null;
  while (element) {
    if (element.scrollWidth - element.clientWidth > 1) {
      const overflowX = getComputedStyle(element).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
    element = element.parentElement;
  }
  return false;
}

function desktopPaneClass(base: string, hidden: boolean): string {
  return hidden ? `${base} split-pane--hidden` : base;
}

export function WorkspaceLayout({
  mode,
  reader,
  notes,
}: {
  mode: WorkspaceLayoutMode;
  reader: ReactNode;
  notes: ReactNode;
}): React.ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const readerPaneRef = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(62);
  const [dragging, setDragging] = useState(false);
  const mobile = mode.kind === "mobile";
  const expandedPane = mode.kind === "desktop" ? mode.expandedPane : null;
  const visiblePct = expandedPane === "left" ? 100 : expandedPane === "right" ? 0 : pct;
  const hideReader = !dragging && expandedPane === "right";
  const hideNotes = !dragging && expandedPane === "left";
  const lockedRef = useRef(false);

  const swipe = useSwipeable({
    onSwipeStart: (event) => {
      lockedRef.current = startedOnHorizontalScroller(event.event.target);
    },
    onSwipedLeft: () => {
      if (mode.kind === "mobile" && !lockedRef.current) mode.onPane("notes");
    },
    onSwipedRight: () => {
      if (mode.kind === "mobile" && !lockedRef.current) mode.onPane("reader");
    },
    onSwipedUp: () => {
      if (mode.kind === "mobile" && mode.pane === "reader") mode.onChromeHiddenChange(true);
    },
    onSwipedDown: () => {
      if (mode.kind === "mobile" && mode.pane === "reader") mode.onChromeHiddenChange(false);
    },
    delta: {
      left: PANE_SWIPE_DELTA_PX,
      right: PANE_SWIPE_DELTA_PX,
      up: CHROME_SWIPE_DELTA_PX,
      down: CHROME_SWIPE_DELTA_PX,
    },
    preventScrollOnSwipe: mode.kind === "mobile" && mode.pane === "reader",
    swipeDuration: PANE_SWIPE_DURATION_MS,
    trackMouse: false,
  });

  function startDrag(): void {
    if (mode.kind !== "desktop") return;
    setDragging(true);
    let latest = visiblePct;
    const move = (event: PointerEvent) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = ((event.clientX - rect.left) / rect.width) * 100;
      latest = Math.min(100, Math.max(0, next));
      // Keep the heavy reader tree out of pointer-move reconciliation while
      // its ResizeObserver still follows the live geometry.
      if (readerPaneRef.current) readerPaneRef.current.style.width = `${latest}%`;
    };
    const stop = () => {
      setDragging(false);
      if (latest <= MIN_PCT) mode.onExpandedPaneChange("right");
      else if (latest >= MAX_PCT) mode.onExpandedPaneChange("left");
      else {
        mode.onExpandedPaneChange(null);
        setPct(latest);
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  const expandedClass = expandedPane === null ? "" : ` split--expanded-${expandedPane}`;
  const rootClass = mobile
    ? "workspace-layout pager"
    : `workspace-layout ${dragging ? "split is-dragging" : "split"}${expandedClass}`;
  const trackClass = mobile ? "workspace-layout-track pager-track" : "workspace-layout-track";
  const readerClass = mobile ? "pager-page" : desktopPaneClass("split-pane", hideReader);
  const notesClass = mobile
    ? "pager-page"
    : desktopPaneClass("split-pane split-pane--grow", hideNotes);

  return (
    <div className={rootClass} ref={rootRef}>
      <div
        className={trackClass}
        style={mobile && mode.pane === "notes" ? { transform: "translateX(-100%)" } : undefined}
        {...(mobile ? swipe : {})}
      >
        <div
          key="reader"
          className={readerClass}
          ref={readerPaneRef}
          style={mobile ? undefined : { width: `${visiblePct}%` }}
          aria-hidden={mobile ? undefined : hideReader}
        >
          {reader}
        </div>
        {!mobile && <div key="divider" className="split-divider" onPointerDown={startDrag} />}
        <div key="notes" className={notesClass} aria-hidden={mobile ? undefined : hideNotes}>
          {notes}
        </div>
      </div>
      {mobile && (
        <div className="pager-tabs">
          {mode.selecting ? (
            <>
              <button
                type="button"
                className="pager-add-note"
                onClick={mode.onAddNote}
                title="Add a note on this selection"
              >
                Add Note
              </button>
              <button
                type="button"
                className="pager-add-note pager-highlight"
                onClick={mode.onHighlight}
                title="Highlight this selection"
              >
                Highlight
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                aria-pressed={mode.pane === "reader"}
                onClick={() => mode.onPane("reader")}
                title="Show reader"
              >
                Reader
              </button>
              <button
                type="button"
                aria-pressed={mode.pane === "notes"}
                onClick={() => mode.onPane("notes")}
                title="Show notes"
              >
                Notes
              </button>
            </>
          )}
        </div>
      )}
      {!mobile && dragging && <div className="split-overlay" />}
    </div>
  );
}
