import type { Highlight } from "../highlights/types.ts";

export function HighlightList({
  highlights,
  onJump,
  onDelete,
}: {
  highlights: Highlight[];
  onJump: (h: Highlight) => void;
  onDelete: (h: Highlight) => void;
}) {
  return (
    <aside className="highlight-list">
      <h2>Highlights</h2>
      {highlights.length === 0 && <p className="empty">Select text to highlight.</p>}
      <ul>
        {highlights.map((h) => (
          <li key={h.id}>
            <button className="quote" onClick={() => onJump(h)}>
              {h.quote.exact}
            </button>
            <button className="delete" onClick={() => onDelete(h)} aria-label="delete">
              ✕
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
