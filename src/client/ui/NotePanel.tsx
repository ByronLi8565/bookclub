import editIcon from "../../../assets/edit.svg";
import type { Note } from "../notes/types.ts";
import { NoteEditor } from "./editor/NoteEditor.tsx";
import { NoteBodyView } from "./editor/NoteBodyView.tsx";

// "username at Jun 13, 5:00 PM"
function noteTitle(note: Note): string {
  const when = new Date(note.createdAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${note.author} at ${when}`;
}

// Right-pane list of notes. Each existing note can be edited inline, jumped to,
// or deleted. A compose slot at the bottom — where a new note lands — edits an
// armed (painted) highlight into a note. Bodies render via renderNoteBody.
export function NotePanel({
  notes,
  composing,
  composeInitialBody,
  editingId,
  onComposeSave,
  onComposeCancel,
  onEdit,
  onEditSave,
  onEditCancel,
  onJump,
  onDelete,
}: {
  notes: Note[];
  composing: boolean;
  composeInitialBody: string;
  editingId: string | null;
  onComposeSave: (body: string) => void;
  onComposeCancel: () => void;
  onEdit: (note: Note) => void;
  onEditSave: (note: Note, body: string) => void;
  onEditCancel: () => void;
  onJump: (note: Note) => void;
  onDelete: (note: Note) => void;
}) {
  return (
    <aside className="note-panel">
      <h2>Notes</h2>
      {notes.length === 0 && !composing && <p className="empty">Select text to add a note.</p>}
      <ul>
        {notes.map((note) => {
          const quote = note.highlights[0]?.quote.exact ?? "";
          if (editingId === note.id) {
            return (
              <li key={note.id} className="note editing">
                <div className="note-head">
                  <button className="quote" disabled>
                    {noteTitle(note)} (editing)
                  </button>
                </div>
                <NoteEditor
                  initialBody={note.body}
                  submitLabel="Save"
                  onSave={(body) => onEditSave(note, body)}
                  onCancel={onEditCancel}
                />
              </li>
            );
          }
          return (
            <li key={note.id} className="note">
              <div className="note-head">
                <button className="quote" onClick={() => onJump(note)} disabled={!quote}>
                  {noteTitle(note)}
                </button>
                <button className="edit" onClick={() => onEdit(note)} aria-label="edit">
                  <img src={editIcon} alt="" aria-hidden="true" />
                </button>
                <button className="delete" onClick={() => onDelete(note)} aria-label="delete">
                  ✕
                </button>
              </div>
              {note.body && <NoteBodyView body={note.body} />}
            </li>
          );
        })}
        {composing && (
          <li className="note compose">
            <NoteEditor
              initialBody={composeInitialBody}
              submitLabel="Publish"
              onSave={onComposeSave}
              onCancel={onComposeCancel}
            />
          </li>
        )}
      </ul>
    </aside>
  );
}
