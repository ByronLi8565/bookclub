import { Fragment, useEffect, useRef, useState } from "react";
import editIcon from "../../../../assets/edit.svg";
import { effectiveHighlight, type Note } from "../../notes/render.ts";
import { NoteEditor } from "./editor/NoteEditor.tsx";
import { NoteBodyView } from "./editor/NoteBodyView.tsx";

// Replies indent one level each, up to this many levels; deeper replies render
// flat at the deepest indent rather than marching off the right edge.
const MAX_INDENT = 4;

export function noteTitle(note: Note): string {
  const when = new Date(note.createdAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const verb = note.parent === null ? "posted" : "replied";
  return `${note.author.name} ${verb} ${when}`;
}

// Read-view data shared by every row: which seqs resolve (for editor chips),
// id -> note (for anchor inheritance), and seq -> snippet (for read chips).
export interface NoteRefs {
  validSeqs: Set<number>;
  byId: Map<string, Note>;
  refs: Map<number, string>;
}

// The signed-in caller, used to gate edit/delete affordances per note. The
// server is the enforcer (decision 7); these only hide buttons that would be
// rejected anyway. A member may edit their own note; the author or the group
// owner may delete one.
export interface NoteViewer {
  userId: string;
  isOwner: boolean;
}

// The per-note callbacks and the single-open-editor selectors, threaded down to
// every row in a thread.
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

// One note: its head and body (or an inline edit editor), followed by an inline
// reply editor when this note is the reply target.
function NoteRow({
  note,
  actions,
  refs,
  canWrite,
  viewer,
}: {
  note: Note;
  actions: NoteActions;
  refs: NoteRefs;
  canWrite: boolean;
  viewer: NoteViewer;
}) {
  // A note can jump if it (or an ancestor, for replies) carries a highlight.
  const anchored = effectiveHighlight(note, refs.byId) !== null;
  const deleted = note.deletedAt !== null;
  // Affordance gating (decision 7): author edits own; author or owner deletes.
  const isAuthor = note.author.id === viewer.userId;
  const canEdit = isAuthor;
  const canDelete = isAuthor || viewer.isOwner;
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
    return (
      <div className="note editing" id={`note-${note.seq}`}>
        <div className="note-head">
          <span className="note-seq">{note.seq}</span>
          <button className="quote" disabled>
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
        />
      </div>
    );
  }

  return (
    <>
      <div className={deleted ? "note note--deleted" : "note"} id={`note-${note.seq}`}>
        <div className="note-head">
          <span className="note-seq">{note.seq}</span>
          <button
            className="quote"
            onClick={() => actions.onJump(note)}
            disabled={!anchored}
            title={anchored ? "Jump to highlight" : undefined}
          >
            {noteTitle(note)}
          </button>
          {!deleted && (
            <button
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
                <div className="delete-confirm" role="dialog" aria-label="Confirm delete">
                  <p>really delete?</p>
                  <div className="delete-confirm-actions">
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(false)}
                      aria-label="cancel delete"
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
                      disabled={!canWrite}
                    >
                      ✓
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {note.body && (
          <NoteBodyView body={note.body} refs={refs.refs} onReference={actions.onReference} />
        )}
      </div>
      {!deleted && actions.replyingTo === note.id && (
        <div className="note reply-compose">
          <NoteEditor
            initialBody=""
            submitLabel="Reply"
            onSave={(body) => actions.onReplySave(note.id, body)}
            onCancel={actions.onReplyCancel}
            validSeqs={refs.validSeqs}
            canSubmit={canWrite}
          />
        </div>
      )}
    </>
  );
}

// The replies of a note, each rendered recursively. `depth` is the indent level
// of this group; past MAX_INDENT we stop nesting and render flat at that level.
function Replies({
  parent,
  childrenOf,
  actions,
  refs,
  canWrite,
  viewer,
  depth,
}: {
  parent: Note;
  childrenOf: (id: string) => Note[];
  actions: NoteActions;
  refs: NoteRefs;
  canWrite: boolean;
  viewer: NoteViewer;
  depth: number;
}) {
  const children = childrenOf(parent.id);
  if (children.length === 0) return null;

  const content = children.map((child) => (
    <Fragment key={child.id}>
      <NoteRow note={child} actions={actions} refs={refs} canWrite={canWrite} viewer={viewer} />
      <Replies
        parent={child}
        childrenOf={childrenOf}
        actions={actions}
        refs={refs}
        canWrite={canWrite}
        viewer={viewer}
        depth={depth + 1}
      />
    </Fragment>
  ));

  return depth <= MAX_INDENT ? <div className="replies">{content}</div> : content;
}

// A top-level note plus its nested reply tree.
export function NoteThread({
  root,
  childrenOf,
  actions,
  refs,
  canWrite,
  viewer,
}: {
  root: Note;
  childrenOf: (id: string) => Note[];
  actions: NoteActions;
  refs: NoteRefs;
  canWrite: boolean;
  viewer: NoteViewer;
}) {
  return (
    <li className="note-thread">
      <NoteRow note={root} actions={actions} refs={refs} canWrite={canWrite} viewer={viewer} />
      <Replies
        parent={root}
        childrenOf={childrenOf}
        actions={actions}
        refs={refs}
        canWrite={canWrite}
        viewer={viewer}
        depth={1}
      />
    </li>
  );
}
