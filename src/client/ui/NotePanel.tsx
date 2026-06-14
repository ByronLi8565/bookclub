import type { Conversation } from "../conversation.ts";
import { NoteEditor } from "./editor/NoteEditor.tsx";
import { NoteThread, type NoteActions, type NoteRefs } from "./NoteThread.tsx";

// Right-pane list of note threads.
export function NotePanel({
  conversation,
  canWrite,
  composing,
  composeInitialBody,
  onComposeSave,
  onComposeCancel,
  actions,
  refs,
}: {
  conversation: Conversation;
  canWrite: boolean;
  composing: boolean;
  composeInitialBody: string;
  onComposeSave: (body: string) => void;
  onComposeCancel: () => void;
  actions: NoteActions;
  refs: NoteRefs;
}) {
  const { roots } = conversation;

  return (
    <aside className="note-panel">
      <h2>Notes</h2>
      {roots.length === 0 && !composing && <p className="empty">Select text to add a note.</p>}
      <ul>
        {roots.map((root) => (
          <NoteThread
            key={root.id}
            root={root}
            childrenOf={conversation.childrenOf}
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
