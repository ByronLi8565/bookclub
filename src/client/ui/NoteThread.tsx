import { Fragment, useEffect, useRef, useState } from "react";
import editIcon from "../../../assets/edit.svg";
import { effectiveHighlight, type Note } from "../notes.ts";
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
  return `${note.author} ${verb} ${when}`;
}

// Read-view data shared by every row: which seqs resolve (for editor chips),
// id -> note (for anchor inheritance), and seq -> snippet (for read chips).
export interface NoteRefs {
  validSeqs: Set<number>;
  byId: Map<string, Note>;
  refs: Map<number, string>;
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
function NoteRow({ note, actions, refs }: { note: Note; actions: NoteActions; refs: NoteRefs }) {
  // A note can jump if it (or an ancestor, for replies) carries a highlight.
  const anchored = effectiveHighlight(note, refs.byId) !== null;
  const deleted = note.deletedAt !== null;
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
          {!deleted && (
            <button
              className="edit"
              onClick={() => actions.onEdit(note)}
              aria-label="edit"
              title="Edit"
            >
              <img src={editIcon} alt="" aria-hidden="true" />
            </button>
          )}
          {!deleted && (
            <div className="delete-wrap" ref={confirmRef}>
              <button
                className="delete"
                onClick={() => setConfirmingDelete(true)}
                aria-label="delete"
                title="Delete"
                aria-expanded={confirmingDelete}
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
  childrenMap,
  actions,
  refs,
  depth,
}: {
  parent: Note;
  childrenMap: Map<string, Note[]>;
  actions: NoteActions;
  refs: NoteRefs;
  depth: number;
}) {
  const children = (childrenMap.get(parent.id) ?? []).toSorted((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  if (children.length === 0) return null;

  const content = children.map((child) => (
    <Fragment key={child.id}>
      <NoteRow note={child} actions={actions} refs={refs} />
      <Replies
        parent={child}
        childrenMap={childrenMap}
        actions={actions}
        refs={refs}
        depth={depth + 1}
      />
    </Fragment>
  ));

  return depth <= MAX_INDENT ? <div className="replies">{content}</div> : content;
}

// A top-level note plus its nested reply tree.
export function NoteThread({
  root,
  childrenMap,
  actions,
  refs,
}: {
  root: Note;
  childrenMap: Map<string, Note[]>;
  actions: NoteActions;
  refs: NoteRefs;
}) {
  return (
    <li className="note-thread">
      <NoteRow note={root} actions={actions} refs={refs} />
      <Replies parent={root} childrenMap={childrenMap} actions={actions} refs={refs} depth={1} />
    </li>
  );
}
