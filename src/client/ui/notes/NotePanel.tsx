import type { Conversation } from "../../notes/conversation.ts";
import { Loading } from "../shared/Loading.tsx";
import { NoteEditor } from "./editor/NoteEditor.tsx";
import { NoteThread, type NoteActions, type NoteRefs, type NoteViewer } from "./NoteThread.tsx";

export function NotePanel({
  conversation,
  canWrite,
  composing,
  loading,
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
  loading: boolean;
  composeInitialBody: string;
  onComposeSave: (body: string) => void;
  onComposeCancel: () => void;
  actions: NoteActions;
  refs: NoteRefs;
  viewer: NoteViewer;
  context?: React.ReactNode;
}) {
  const { roots } = conversation;

  return (
    <aside className="note-panel">
      {context}
      <h2>Notes</h2>
      {loading && !composing && <Loading className="loading--note-panel" />}
      {!loading && roots.length === 0 && !composing && (
        <p className="empty">Select text to add a note.</p>
      )}
      <ul>
        {!loading &&
          roots.map((root) => (
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
