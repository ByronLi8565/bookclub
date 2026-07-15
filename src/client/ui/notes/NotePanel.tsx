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

const NO_CONTEXT_NOTES: ReadonlySet<string> = new Set();

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
  filters,
  hasActiveFilters,
  showBookTitles,
  showHashtags,
  hashtagsAddTags,
  bookTitleFor,
  contextNoteIds,
  imageUrlBase,
  avatarFor,
}: {
  conversation: Conversation;
  canWrite: boolean;
  composing: boolean;
  loading: boolean;
  composeInitialBody: string;
  onComposeSave: (body: string, tags?: string[]) => void;
  onComposeCancel: () => void;
  onPasteImage?: (file: File) => Promise<UploadedNoteImage | null>;
  actions: NoteActions;
  refs: NoteRefs;
  viewer: NoteViewer;
  context?: React.ReactNode;
  filters?: React.ReactNode;
  hasActiveFilters?: boolean;
  showBookTitles?: boolean;
  showHashtags?: boolean;
  hashtagsAddTags?: boolean;
  bookTitleFor?: (sourceId: string) => string;
  contextNoteIds?: ReadonlySet<string>;
  imageUrlBase?: string;
  avatarFor?: AvatarResolver;
}) {
  const { roots } = conversation;

  return (
    <aside className="note-panel">
      {context}
      <div className="note-panel-toolbar">
        <h2 className="label">Notes</h2>
        {filters}
      </div>
      {loading && !composing && <Loading className="loading--note-panel" />}
      {!loading && roots.length === 0 && !composing && (
        <p className="empty">
          {hasActiveFilters ? "No notes match these filters." : "Select text to add a note."}
        </p>
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
              showBookTitles={showBookTitles ?? false}
              showHashtags={showHashtags ?? true}
              hashtagsAddTags={hashtagsAddTags ?? false}
              bookTitleFor={bookTitleFor}
              contextNoteIds={contextNoteIds ?? NO_CONTEXT_NOTES}
            />
          ))}
        {composing && (
          <li className="note compose">
            <NoteEditor
              initialBody={composeInitialBody}
              hashtagsAddTags={hashtagsAddTags}
              showHashtags={showHashtags}
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
