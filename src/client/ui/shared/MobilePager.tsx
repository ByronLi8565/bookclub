import { useRef, type ReactNode } from "react";
import { useSwipeable } from "react-swipeable";

export type Pane = "reader" | "notes";

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
}: {
  pane: Pane;
  onPane: (p: Pane) => void;
  reader: ReactNode;
  notes: ReactNode;

  selecting: boolean;
  onAddNote: () => void;
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
    delta: 100,
    //Swipes have a max duration
    swipeDuration: 250,
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
          <button
            type="button"
            className="pager-add-note"
            onClick={onAddNote}
            title="Add a note on this selection"
          >
            Add Note
          </button>
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
