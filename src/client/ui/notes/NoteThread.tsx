import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import editIcon from "@assets/edit.svg";
import type { Note, NoteAuthor } from "../../../shared/types/notes.ts";
import { effectiveHighlight } from "../../logic/notes/conversation.ts";
import { noteTitle } from "../../logic/notes/format.ts";
import { canDeleteNote, canEditNote, type NoteViewer } from "../../logic/notes/permissions.ts";
import { NoteEditor } from "./editor/NoteEditor.tsx";
import type { UploadedNoteImage } from "./editor/NoteImageNode.tsx";
import { NoteBodyView } from "./editor/NoteBodyView.tsx";

export type { NoteViewer } from "../../logic/notes/permissions.ts";

const MAX_INDENT = 4;

// A note author's picture, already resolved to a URL (or null when they have no
// avatar, in which case `initials` is shown on black). Kept pre-resolved so the
// note tree stays ignorant of how avatars are stored/addressed.
export interface AuthorAvatar {
  url: string | null;
  initials: string;
  name: string;
}

export type AvatarResolver = (author: NoteAuthor) => AuthorAvatar;

function AuthorPic({ avatar }: { avatar: AuthorAvatar }) {
  return (
    <span className="note-avatar" title={avatar.name}>
      {avatar.url ? (
        <img src={avatar.url} alt="" />
      ) : (
        <span aria-hidden="true">{avatar.initials}</span>
      )}
    </span>
  );
}

export interface NoteRefs {
  validSeqs: Set<number>;
  byId: Map<string, Note>;
  refs: Map<number, string>;
  canReference: boolean;
  pendingNoteIds: ReadonlySet<string>;
  failedNoteIds: ReadonlySet<string>;
}

export interface NoteActions {
  editingId: string | null;
  replyingTo: string | null;
  onJump: (note: Note) => void;
  onReference: (seq: number) => void;
  onDelete: (note: Note) => void;
  onEdit: (note: Note) => void;
  onEditSave: (note: Note, body: string) => void;
  onEditCancel: () => void;
  onReply: (note: Note) => void;
  onReplySave: (parentId: string, body: string) => void;
  onReplyCancel: () => void;
}

export function NoteCardView({
  seq,
  title,
  body,
  refs,
  onReference,
  imageUrlBase,
  id,
  deleted = false,
  jump,
  actions,
}: {
  seq: number;
  title: string;
  body: string;
  refs: Map<number, string>;
  onReference: (seq: number) => void;
  imageUrlBase?: string;
  id?: string;
  deleted?: boolean;
  jump?: { onClick: () => void; disabled: boolean; title?: string };
  actions?: ReactNode;
}): React.ReactElement {
  return (
    <div className={deleted ? "note note--deleted" : "note"} id={id}>
      <div className="note-head">
        <span className="note-seq">{seq}</span>
        {jump ? (
          <button
            type="button"
            className="quote truncate"
            onClick={jump.onClick}
            disabled={jump.disabled}
            title={jump.title}
          >
            {title}
          </button>
        ) : (
          <div className="quote truncate">{title}</div>
        )}
        {actions}
      </div>
      {body && (
        <NoteBodyView
          body={body}
          refs={refs}
          onReference={onReference}
          imageUrlBase={imageUrlBase}
        />
      )}
    </div>
  );
}

function NoteRow({
  note,
  actions,
  refs,
  canWrite,
  viewer,
  imageUrlBase,
  onPasteImage,
  avatarFor,
}: {
  note: Note;
  actions: NoteActions;
  refs: NoteRefs;
  canWrite: boolean;
  viewer: NoteViewer;
  imageUrlBase?: string;
  onPasteImage?: (file: File) => Promise<UploadedNoteImage | null>;
  avatarFor?: AvatarResolver;
}) {
  // Chat-style layout: the author's picture floats to the left of the card and
  // all of the row's content (card + any inline editor) shares one column so
  // it stays aligned to the avatar's gutter. When no resolver is supplied
  // (e.g. info cards) we fall through to the plain, avatar-less markup.
  const avatar = avatarFor?.(note.author) ?? null;
  const withAvatar = (content: ReactNode): ReactNode =>
    avatar ? (
      <div className="note-row">
        <AuthorPic avatar={avatar} />
        <div className="note-row-body">{content}</div>
      </div>
    ) : (
      content
    );

  const anchored = effectiveHighlight(note, refs.byId) !== null;
  const deleted = note.deletedAt !== null;
  const syncState = refs.failedNoteIds.has(note.id)
    ? "failed"
    : refs.pendingNoteIds.has(note.id)
      ? "pending"
      : null;
  const canEdit = canEditNote(note, viewer);
  const canDelete = canDeleteNote(note, viewer);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!confirmingDelete) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !confirmRef.current?.contains(target)) {
        setConfirmingDelete(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [confirmingDelete]);

  if (!deleted && actions.editingId === note.id) {
    return withAvatar(
      <div className="note editing" id={`note-${note.seq}`}>
        <div className="note-head">
          <span className="note-seq">{note.seq}</span>
          <button type="button" className="quote truncate" disabled>
            {noteTitle(note)} (editing)
          </button>
        </div>
        <NoteEditor
          initialBody={note.body}
          submitLabel="Save"
          onSave={(body) => actions.onEditSave(note, body)}
          onCancel={actions.onEditCancel}
          validSeqs={refs.validSeqs}
          canSubmit={canWrite}
          canReference={refs.canReference}
          onPasteImage={onPasteImage}
          imageUrlBase={imageUrlBase}
        />
      </div>,
    );
  }

  return withAvatar(
    <>
      <NoteCardView
        seq={note.seq}
        title={noteTitle(note)}
        body={note.body}
        refs={refs.refs}
        onReference={actions.onReference}
        imageUrlBase={imageUrlBase}
        id={`note-${note.seq}`}
        deleted={deleted}
        jump={{
          onClick: () => actions.onJump(note),
          disabled: !anchored,
          title: anchored ? "Jump to highlight" : undefined,
        }}
        actions={
          <>
            {syncState && (
              <span
                className={`note-sync note-sync--${syncState}`}
                title={
                  syncState === "failed"
                    ? "This change couldn't sync and was skipped"
                    : "Not yet synced — will send when you reconnect"
                }
              >
                {syncState === "failed" ? "⚠ unsynced" : "• syncing"}
              </span>
            )}
            {!deleted && (
              <button
                type="button"
                className="reply"
                onClick={() => actions.onReply(note)}
                aria-label="reply"
                title="Reply"
              >
                ↩
              </button>
            )}
            {!deleted && canEdit && (
              <button
                type="button"
                className="edit"
                onClick={() => actions.onEdit(note)}
                aria-label="edit"
                title="Edit"
              >
                <img src={editIcon} alt="" aria-hidden="true" />
              </button>
            )}
            {!deleted && canDelete && (
              <div className="delete-wrap" ref={confirmRef}>
                <button
                  type="button"
                  className="delete"
                  onClick={() => setConfirmingDelete(true)}
                  aria-label="delete"
                  title="Delete"
                  aria-expanded={confirmingDelete}
                  disabled={!canWrite}
                >
                  ✕
                </button>
                {confirmingDelete && (
                  <dialog className="delete-confirm" open aria-label="Confirm delete">
                    <p>Really delete?</p>
                    <div className="delete-confirm-actions">
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(false)}
                        aria-label="cancel delete"
                        title="Keep note"
                      >
                        ✕
                      </button>
                      <span>|</span>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmingDelete(false);
                          actions.onDelete(note);
                        }}
                        aria-label="confirm delete"
                        title="Delete note"
                        disabled={!canWrite}
                      >
                        ✓
                      </button>
                    </div>
                  </dialog>
                )}
              </div>
            )}
          </>
        }
      />
      {!deleted && actions.replyingTo === note.id && (
        <div className="note reply-compose">
          <NoteEditor
            initialBody=""
            submitLabel="Reply"
            onSave={(body) => actions.onReplySave(note.id, body)}
            onCancel={actions.onReplyCancel}
            validSeqs={refs.validSeqs}
            canSubmit={canWrite}
            canReference={refs.canReference}
            onPasteImage={onPasteImage}
            imageUrlBase={imageUrlBase}
          />
        </div>
      )}
    </>,
  );
}

function Replies({
  parent,
  childrenOf,
  actions,
  refs,
  canWrite,
  viewer,
  imageUrlBase,
  onPasteImage,
  avatarFor,
  depth,
}: {
  parent: Note;
  childrenOf: (id: string) => Note[];
  actions: NoteActions;
  refs: NoteRefs;
  canWrite: boolean;
  viewer: NoteViewer;
  imageUrlBase?: string;
  onPasteImage?: (file: File) => Promise<UploadedNoteImage | null>;
  avatarFor?: AvatarResolver;
  depth: number;
}) {
  const children = childrenOf(parent.id);
  if (children.length === 0) return null;

  const content = children.map((child) => (
    <Fragment key={child.id}>
      <NoteRow
        note={child}
        actions={actions}
        refs={refs}
        canWrite={canWrite}
        viewer={viewer}
        imageUrlBase={imageUrlBase}
        onPasteImage={onPasteImage}
        avatarFor={avatarFor}
      />
      <Replies
        parent={child}
        childrenOf={childrenOf}
        actions={actions}
        refs={refs}
        canWrite={canWrite}
        viewer={viewer}
        imageUrlBase={imageUrlBase}
        onPasteImage={onPasteImage}
        avatarFor={avatarFor}
        depth={depth + 1}
      />
    </Fragment>
  ));

  return depth <= MAX_INDENT ? <div className="replies">{content}</div> : content;
}

export function NoteThread({
  root,
  childrenOf,
  actions,
  refs,
  canWrite,
  viewer,
  imageUrlBase,
  onPasteImage,
  avatarFor,
}: {
  root: Note;
  childrenOf: (id: string) => Note[];
  actions: NoteActions;
  refs: NoteRefs;
  canWrite: boolean;
  viewer: NoteViewer;
  imageUrlBase?: string;
  onPasteImage?: (file: File) => Promise<UploadedNoteImage | null>;
  avatarFor?: AvatarResolver;
}) {
  return (
    <li className="note-thread">
      <NoteRow
        note={root}
        actions={actions}
        refs={refs}
        canWrite={canWrite}
        viewer={viewer}
        imageUrlBase={imageUrlBase}
        onPasteImage={onPasteImage}
        avatarFor={avatarFor}
      />
      <Replies
        parent={root}
        childrenOf={childrenOf}
        actions={actions}
        refs={refs}
        canWrite={canWrite}
        viewer={viewer}
        imageUrlBase={imageUrlBase}
        onPasteImage={onPasteImage}
        avatarFor={avatarFor}
        depth={1}
      />
    </li>
  );
}
