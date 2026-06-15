import { infoCards } from "../../info/infoCards.ts";
import { NoteCardView, noteHeading } from "../notes/NoteThread.tsx";

const EMPTY_REFS = new Map<number, string>();

export function InfoScreen({ onClose }: { onClose: () => void }): React.ReactElement {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal home-info-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-info-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <strong id="home-info-title">RELEASE LOG</strong>
          <button type="button" onClick={onClose} aria-label="close info">
            ✕
          </button>
        </div>

        <div className="modal-body note-panel home-info-cards">
          {infoCards.length === 0 ? (
            <p className="home-info-empty">no info cards yet</p>
          ) : (
            <ul>
              {infoCards.map((card, index) => (
                <li key={card.path} title={card.title}>
                  <NoteCardView
                    seq={card.seq ?? index + 1}
                    title={noteHeading(card.author, "posted", card.date)}
                    body={card.body}
                    refs={EMPTY_REFS}
                    onReference={() => {}}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
