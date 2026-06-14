import type { Conversation } from "../../notes/conversation.ts";
import { NoteEditor } from "./editor/NoteEditor.tsx";
import { NoteThread, type NoteActions, type NoteRefs, type NoteViewer } from "./NoteThread.tsx";

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
  viewer,
  context,
}: {
  conversation: Conversation;
  canWrite: boolean;
  composing: boolean;
  composeInitialBody: string;
  onComposeSave: (body: string) => void;
  onComposeCancel: () => void;
  actions: NoteActions;
  refs: NoteRefs;
  viewer: NoteViewer;
  // The group/book collaboration context rendered above the note list.
  context?: React.ReactNode;
}) {
  const { roots } = conversation;

  return (
    <aside className="note-panel">
      {context}
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
            viewer={viewer}
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
