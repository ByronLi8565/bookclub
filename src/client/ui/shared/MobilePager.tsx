import { useRef, type ReactNode } from "react";
import { useSwipeable } from "react-swipeable";

export type Pane = "reader" | "notes";

const PANE_SWIPE_DELTA_PX = 50;
const CHROME_SWIPE_DELTA_PX = 80;
const PANE_SWIPE_DURATION_MS = 500;

// A pane swipe must not steal a gesture that is panning a scrollable child
// (notably a zoomed-in PDF, which scrolls horizontally). Walk up from the touch
// target and bail if any ancestor can actually scroll on the x-axis.
function startedOnHorizontalScroller(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null;
  while (el) {
    if (el.scrollWidth - el.clientWidth > 1) {
      const overflowX = getComputedStyle(el).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
    el = el.parentElement;
  }
  return false;
}

export function MobilePager({
  pane,
  onPane,
  reader,
  notes,
  selecting,
  onAddNote,
  onHighlight,
  onChromeHiddenChange,
}: {
  pane: Pane;
  onPane: (p: Pane) => void;
  reader: ReactNode;
  notes: ReactNode;

  selecting: boolean;
  onAddNote: () => void;
  onHighlight: () => void;
  onChromeHiddenChange?: (hidden: boolean) => void;
}) {
  const lockedRef = useRef(false);
  const swipe = useSwipeable({
    onSwipeStart: (e) => {
      lockedRef.current = startedOnHorizontalScroller(e.event.target);
    },
    onSwipedLeft: () => {
      if (!lockedRef.current) onPane("notes");
    },
    onSwipedRight: () => {
      if (!lockedRef.current) onPane("reader");
    },
    onSwipedUp: () => {
      if (pane === "reader") onChromeHiddenChange?.(true);
    },
    onSwipedDown: () => {
      if (pane === "reader") onChromeHiddenChange?.(false);
    },
    delta: {
      left: PANE_SWIPE_DELTA_PX,
      right: PANE_SWIPE_DELTA_PX,
      up: CHROME_SWIPE_DELTA_PX,
      down: CHROME_SWIPE_DELTA_PX,
    },
    preventScrollOnSwipe: pane === "reader",
    swipeDuration: PANE_SWIPE_DURATION_MS,
    trackMouse: false,
  });

  return (
    <div className="pager">
      <div
        className="pager-track"
        style={{ transform: pane === "notes" ? "translateX(-100%)" : "none" }}
        {...swipe}
      >
        <div className="pager-page">{reader}</div>
        <div className="pager-page">{notes}</div>
      </div>
      <div className="pager-tabs">
        {selecting ? (
          <>
            <button
              type="button"
              className="pager-add-note"
              onClick={onAddNote}
              title="Add a note on this selection"
            >
              Add Note
            </button>
            <button
              type="button"
              className="pager-add-note pager-highlight"
              onClick={onHighlight}
              title="Highlight this selection"
            >
              Highlight
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              aria-pressed={pane === "reader"}
              onClick={() => onPane("reader")}
              title="Show reader"
            >
              Reader
            </button>
            <button
              type="button"
              aria-pressed={pane === "notes"}
              onClick={() => onPane("notes")}
              title="Show notes"
            >
              Notes
            </button>
          </>
        )}
      </div>
    </div>
  );
}
