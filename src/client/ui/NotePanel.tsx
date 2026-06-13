import type { Note } from "../notes.ts";
import { NoteEditor } from "./editor/NoteEditor.tsx";
import { NoteThread, type NoteActions } from "./NoteThread.tsx";

// Right-pane list of note threads. Top-level notes (parent null, or an orphan
// whose parent no longer resolves) render as threads with their flattened
// replies; a compose slot at the bottom turns the armed highlight into a note.
export function NotePanel({
  notes,
  composing,
  composeInitialBody,
  onComposeSave,
  onComposeCancel,
  actions,
}: {
  notes: Note[];
  composing: boolean;
  composeInitialBody: string;
  onComposeSave: (body: string) => void;
  onComposeCancel: () => void;
  actions: NoteActions;
}) {
  const ids = new Set(notes.map((n) => n.id));
  const childrenMap = new Map<string, Note[]>();
  for (const note of notes) {
    if (note.parent !== null && ids.has(note.parent)) {
      const siblings = childrenMap.get(note.parent) ?? [];
      siblings.push(note);
      childrenMap.set(note.parent, siblings);
    }
  }
  const roots = notes
    .filter((n) => n.parent === null || !ids.has(n.parent))
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <aside className="note-panel">
      <h2>Notes</h2>
      {notes.length === 0 && !composing && <p className="empty">Select text to add a note.</p>}
      <ul>
        {roots.map((root) => (
          <NoteThread key={root.id} root={root} childrenMap={childrenMap} actions={actions} />
        ))}
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
