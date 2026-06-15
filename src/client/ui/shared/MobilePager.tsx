import type { ReactNode } from "react";
import { useSwipeable } from "react-swipeable";

export type Pane = "reader" | "notes";






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
  const swipe = useSwipeable({
    onSwipedLeft: () => onPane("notes"),
    onSwipedRight: () => onPane("reader"),
    delta: 60,
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
          <button className="pager-add-note" onClick={onAddNote}>
            Add Note
          </button>
        ) : (
          <>
            <button aria-pressed={pane === "reader"} onClick={() => onPane("reader")}>
              Reader
            </button>
            <button aria-pressed={pane === "notes"} onClick={() => onPane("notes")}>
              Notes
            </button>
          </>
        )}
      </div>
    </div>
  );
}
