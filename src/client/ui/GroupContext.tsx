import { useState } from "react";
import type { RosterEntry } from "../groups/api.ts";

// The collaboration context shown atop the note panel: which book is in view
// (with an inline rename any member may use) and who's in the club.
export function GroupContext({
  bookTitle,
  members,
  onRename,
}: {
  bookTitle: string;
  members: RosterEntry[];
  onRename: (title: string) => void;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bookTitle);

  function save(): void {
    const title = draft.trim();
    if (title !== "" && title !== bookTitle) onRename(title);
    setEditing(false);
  }

  return (
    <div className="group-context">
      {editing ? (
        <div className="group-book-edit">
          <input
            type="text"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") {
                setDraft(bookTitle);
                setEditing(false);
              }
            }}
          />
          <button type="button" onClick={save}>
            save
          </button>
        </div>
      ) : (
        <div className="group-book">
          <span className="group-book-title">{bookTitle}</span>
          <button
            type="button"
            className="group-book-rename"
            aria-label="rename book"
            title="Rename book"
            onClick={() => {
              setDraft(bookTitle);
              setEditing(true);
            }}
          >
            ✎
          </button>
        </div>
      )}
      <p className="group-roster">
        {members.map((m, i) => (
          <span key={m.id}>
            {m.name}
            {m.role === "owner" && " (owner)"}
            {i < members.length - 1 && ", "}
          </span>
        ))}
      </p>
    </div>
  );
}
