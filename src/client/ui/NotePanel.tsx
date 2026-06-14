import type { Note } from "../notes.ts";
import { NoteEditor } from "./editor/NoteEditor.tsx";
import { NoteThread, type NoteActions, type NoteRefs } from "./NoteThread.tsx";

// Right-pane list of note threads.
export function NotePanel({
  notes,
  canWrite,
  composing,
  composeInitialBody,
  onComposeSave,
  onComposeCancel,
  actions,
  refs,
}: {
  notes: Note[];
  canWrite: boolean;
  composing: boolean;
  composeInitialBody: string;
  onComposeSave: (body: string) => void;
  onComposeCancel: () => void;
  actions: NoteActions;
  refs: NoteRefs;
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
          <NoteThread
            key={root.id}
            root={root}
            childrenMap={childrenMap}
            actions={actions}
            refs={refs}
            canWrite={canWrite}
          />
        ))}
        {composing && (
          <li className="note compose">
            <NoteEditor
              initialBody={composeInitialBody}
              submitLabel="Publish"
              onSave={onComposeSave}
              onCancel={onComposeCancel}
              validSeqs={refs.validSeqs}
              canSubmit={canWrite}
            />
          </li>
        )}
      </ul>
    </aside>
  );
}
