import { useRef, type ReactNode, type Touch, type TouchEvent } from "react";
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
  onChromeHiddenChange,
}: {
  pane: Pane;
  onPane: (p: Pane) => void;
  reader: ReactNode;
  notes: ReactNode;

  selecting: boolean;
  onAddNote: () => void;
  onChromeHiddenChange?: (hidden: boolean) => void;
}) {
  const lockedRef = useRef(false);
  const verticalStartRef = useRef<{ x: number; y: number; at: number } | null>(null);
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
    delta: 50,
    // Swipes have a max duration.
    swipeDuration: 500,
    trackMouse: false,
  });

  const onTouchStartCapture = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    verticalStartRef.current =
      pane === "reader" && touch ? { x: touch.clientX, y: touch.clientY, at: Date.now() } : null;
  };

  const maybeToggleChrome = (touch: Touch | undefined) => {
    const start = verticalStartRef.current;
    if (!start || !touch || !onChromeHiddenChange) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const quickEnough = Date.now() - start.at <= 900;
    if (quickEnough && absY >= 48 && absY > absX * 1.2) {
      verticalStartRef.current = null;
      onChromeHiddenChange(dy < 0);
    }
  };

  const onTouchMoveCapture = (event: TouchEvent<HTMLDivElement>) => {
    maybeToggleChrome(event.touches[0]);
  };

  const onTouchEndCapture = (event: TouchEvent<HTMLDivElement>) => {
    maybeToggleChrome(event.changedTouches[0]);
    verticalStartRef.current = null;
  };

  const onTouchCancelCapture = () => {
    verticalStartRef.current = null;
  };

  return (
    <div className="pager">
      <div
        className="pager-track"
        style={{ transform: pane === "notes" ? "translateX(-100%)" : "none" }}
        {...swipe}
        onTouchStartCapture={onTouchStartCapture}
        onTouchMoveCapture={onTouchMoveCapture}
        onTouchEndCapture={onTouchEndCapture}
        onTouchCancelCapture={onTouchCancelCapture}
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
