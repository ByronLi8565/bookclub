import type { Conversation } from "../../logic/notes/conversation.ts";
import { Loading } from "../shared/Loading.tsx";
import { NoteEditor } from "./editor/NoteEditor.tsx";
import type { UploadedNoteImage } from "./editor/NoteImageNode.tsx";
import {
  NoteThread,
  type AvatarResolver,
  type NoteActions,
  type NoteRefs,
  type NoteViewer,
} from "./NoteThread.tsx";

export function NotePanel({
  conversation,
  canWrite,
  composing,
  loading,
  composeInitialBody,
  onComposeSave,
  onComposeCancel,
  onPasteImage,
  actions,
  refs,
  viewer,
  context,
  imageUrlBase,
  avatarFor,
}: {
  conversation: Conversation;
  canWrite: boolean;
  composing: boolean;
  loading: boolean;
  composeInitialBody: string;
  onComposeSave: (body: string) => void;
  onComposeCancel: () => void;
  onPasteImage?: (file: File) => Promise<UploadedNoteImage | null>;
  actions: NoteActions;
  refs: NoteRefs;
  viewer: NoteViewer;
  context?: React.ReactNode;
  imageUrlBase?: string;
  avatarFor?: AvatarResolver;
}) {
  const { roots } = conversation;

  return (
    <aside className="note-panel">
      {context}
      <h2 className="label">Notes</h2>
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
              imageUrlBase={imageUrlBase}
              onPasteImage={onPasteImage}
              avatarFor={avatarFor}
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
              canReference={refs.canReference}
              onPasteImage={onPasteImage}
              imageUrlBase={imageUrlBase}
            />
          </li>
        )}
      </ul>
    </aside>
  );
}
