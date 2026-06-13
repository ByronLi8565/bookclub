import type { Card } from "../cards/types.ts";

// Right-pane list of cards. Step 1: top-level cards shown by their quote, with
// jump-to-passage and delete. The editor and threaded replies arrive later.
export function CardPanel({
  cards,
  onJump,
  onDelete,
}: {
  cards: Card[];
  onJump: (card: Card) => void;
  onDelete: (card: Card) => void;
}) {
  return (
    <aside className="card-panel">
      <h2>Cards</h2>
      {cards.length === 0 && <p className="empty">Select text to add a note.</p>}
      <ul>
        {cards.map((card) => {
          const quote = card.highlights[0]?.quote.exact ?? "";
          return (
            <li key={card.id} className="card">
              <button className="quote" onClick={() => onJump(card)} disabled={!quote}>
                {quote}
              </button>
              <button className="delete" onClick={() => onDelete(card)} aria-label="delete">
                ✕
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
