import { Fragment } from "react";
import editIcon from "../../../assets/edit.svg";
import type { Note } from "../notes.ts";
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

// The per-note callbacks and the single-open-editor selectors, threaded down to
// every row in a thread.
export interface NoteActions {
  editingId: string | null;
  replyingTo: string | null;
  onJump: (note: Note) => void;
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
function NoteRow({ note, actions }: { note: Note; actions: NoteActions }) {
  const quote = note.highlights[0]?.quote.exact ?? "";

  if (actions.editingId === note.id) {
    return (
      <div className="note editing">
        <div className="note-head">
          <button className="quote" disabled>
            {noteTitle(note)} (editing)
          </button>
        </div>
        <NoteEditor
          initialBody={note.body}
          submitLabel="Save"
          onSave={(body) => actions.onEditSave(note, body)}
          onCancel={actions.onEditCancel}
        />
      </div>
    );
  }

  return (
    <>
      <div className="note">
        <div className="note-head">
          <button className="quote" onClick={() => actions.onJump(note)} disabled={!quote}>
            {noteTitle(note)}
          </button>
          <button className="reply" onClick={() => actions.onReply(note)} aria-label="reply">
            ↩
          </button>
          <button className="edit" onClick={() => actions.onEdit(note)} aria-label="edit">
            <img src={editIcon} alt="" aria-hidden="true" />
          </button>
          <button className="delete" onClick={() => actions.onDelete(note)} aria-label="delete">
            ✕
          </button>
        </div>
        {note.body && <NoteBodyView body={note.body} />}
      </div>
      {actions.replyingTo === note.id && (
        <div className="note reply-compose">
          <NoteEditor
            initialBody=""
            submitLabel="Reply"
            onSave={(body) => actions.onReplySave(note.id, body)}
            onCancel={actions.onReplyCancel}
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
  depth,
}: {
  parent: Note;
  childrenMap: Map<string, Note[]>;
  actions: NoteActions;
  depth: number;
}) {
  const children = (childrenMap.get(parent.id) ?? []).toSorted((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  if (children.length === 0) return null;

  const content = children.map((child) => (
    <Fragment key={child.id}>
      <NoteRow note={child} actions={actions} />
      <Replies parent={child} childrenMap={childrenMap} actions={actions} depth={depth + 1} />
    </Fragment>
  ));

  return depth <= MAX_INDENT ? <div className="replies">{content}</div> : content;
}

// A top-level note plus its nested reply tree.
export function NoteThread({
  root,
  childrenMap,
  actions,
}: {
  root: Note;
  childrenMap: Map<string, Note[]>;
  actions: NoteActions;
}) {
  return (
    <li className="note-thread">
      <NoteRow note={root} actions={actions} />
      <Replies parent={root} childrenMap={childrenMap} actions={actions} depth={1} />
    </li>
  );
}
