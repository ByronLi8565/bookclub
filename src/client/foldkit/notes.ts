import editIcon from "@assets/edit.svg";
import { Effect, Option, Schema } from "effect";
import { Command } from "foldkit";
import * as FoldkitFile from "foldkit/file";
import type { Html, HtmlBuilder } from "foldkit/html";
import { m } from "foldkit/message";
import { UPLOAD_FILE_FIELD } from "../../shared/http/uploads.ts";
import { noteImageIds } from "../../shared/notes/images.ts";
import { isHiddenTag, isReservedTag, normalizeTag } from "../../shared/notes/tags.ts";
import {
  HIGHLIGHT_TAG,
  Highlight,
  Note,
  NoteOp,
  type HighlightAnchor,
  type NoteAuthor,
  type QuoteSelector,
} from "../../shared/types/notes.ts";
import { effectiveHighlight } from "../logic/notes/conversation.ts";
import { blockquote, highlightMark, noteSnippet, noteTitle } from "../logic/notes/format.ts";
import { bookclubClient } from "../logic/net/bookclubClient.ts";
import {
  filterConversation,
  filterTermKey,
  filterTermLabel,
  noteFilterSuggestions,
} from "../logic/notes/noteQuery.ts";
import { addNoteOp, addReplyOp, editNoteOp, removeNoteOp } from "../logic/notes/noteOps.ts";
import { canDeleteNote, canEditNote, type NoteViewer } from "../logic/notes/permissions.ts";
import { noteBodyView } from "./noteBody.ts";
import {
  NoteFilterMode,
  NoteFilterTerm,
  NotesScopeKind,
  noteQueryContextOf,
  noteQueryOf,
  notesScopeOf,
} from "./notesFilters.ts";
import {
  ChangedNoteDraft,
  ChangedNoteDraftSelection,
  ExtractedNoteDraftTags,
  FailedNoteEditor,
  NoteDraftEditor,
  PastedNoteImage,
  RemovedNoteImage,
  RetriedNoteImage,
  noteEditor,
} from "./mounts/lexical.ts";
import {
  ChangedNoteAgentPresence,
  ChangedNoteAgentStatus,
  ChangedNotes,
  ConnectedNoteAgent,
  DroppedNoteOperation,
  FailedNoteAgentConnection,
  FailedNoteFlush,
  QueuedNoteOperation,
  RejectedNoteOperations,
  ReleasedNoteAgent,
  StampedNoteAgentIdentity,
  enqueueNoteOperation,
} from "./resources/noteAgent.ts";

const OnlinePeer = ChangedNoteAgentPresence.fields.peers;

const DraftFormat = Schema.Struct({
  collapsed: Schema.Boolean,
  bold: Schema.Boolean,
  italic: Schema.Boolean,
  highlight: Schema.Boolean,
});

export const NotesModel = Schema.Struct({
  ready: Schema.Boolean,
  status: Schema.Literals(["syncing", "online", "offline"]),
  /**
   * The group whose socket is actually acquired, null until `ConnectedNoteAgent`
   * arrives and again once it is released. The event Subscription gates on this
   * rather than on the requirements, so it never starts before the queue it
   * reads exists and restarts when a club switch hands out a new one.
   */
  connectionKey: Schema.NullOr(Schema.String),
  notes: Schema.Array(Note),
  pendingNoteIds: Schema.Array(Schema.String),
  failedNoteIds: Schema.Array(Schema.String),
  pendingCount: Schema.Number,
  peers: OnlinePeer,
  draft: Schema.String,
  draftTags: Schema.Array(Schema.String),
  draftHighlights: Schema.Array(Highlight),
  focusedNoteId: Schema.NullOr(Schema.String),
  draftImageIds: Schema.Array(Schema.String),
  /** Images in the editor whose upload has not settled. */
  unresolvedImages: Schema.Number,
  /** The club whose draft the editor is holding, learned from the editor
   *  itself, so an abandoned upload can be cleaned up without the view. */
  groupRef: Schema.NullOr(Schema.String),
  draftFormat: DraftFormat,
  uploadingImage: Schema.Boolean,
  /**
   * Bumped whenever the composer must be re-seeded from the Model rather than
   * from what the reader has typed. The editor element is keyed on it, so the
   * Mount is torn down and rebuilt only on those transitions — never on the
   * draft changes the editor itself published.
   */
  composerGeneration: Schema.Number,
  editingNoteId: Schema.NullOr(Schema.String),
  /** The composer is open for a new note, which is what the reader's "Add Note"
   *  and an attached quote both mean. */
  composing: Schema.Boolean,
  /** The note the composer is answering, which is where it renders. */
  replyingToNoteId: Schema.NullOr(Schema.String),
  /** The note whose delete confirmation is showing; only ever one. */
  confirmingDeleteNoteId: Schema.NullOr(Schema.String),
  scope: NotesScopeKind,
  filterTerms: Schema.Array(NoteFilterTerm),
  filterMode: NoteFilterMode,
  filterInput: Schema.String,
  error: Schema.NullOr(Schema.String),
});
export type NotesModel = typeof NotesModel.Type;

export const StartedNote = m("StartedNote");
export const StartedNoteEdit = m("StartedNoteEdit", {
  noteId: Schema.String,
  body: Schema.String,
  tags: Schema.Array(Schema.String),
  highlights: Schema.Array(Highlight),
});
export const ChangedNoteComposer = m("ChangedNoteComposer", {
  body: Schema.String,
  tags: Schema.Array(Schema.String),
  highlights: Schema.Array(Highlight),
});
export const CancelledNoteComposer = m("CancelledNoteComposer");
export const AttachedNoteHighlight = m("AttachedNoteHighlight", { highlight: Highlight });
/** A note the reader pointed at, by the highlight the reader was showing. */
export const FocusedNoteHighlight = m("FocusedNoteHighlight", {
  highlightId: Schema.NullOr(Schema.String),
});
export const SubmittedNoteOperation = m("SubmittedNoteOperation", { op: NoteOp });
export const SelectedNoteImage = m("SelectedNoteImage", {
  groupRef: Schema.String,
  file: FoldkitFile.File,
});
export const UploadedNoteImage = m("UploadedNoteImage", {
  token: Schema.String,
  imageId: Schema.String,
});
export const FailedNoteImageUpload = m("FailedNoteImageUpload", {
  token: Schema.String,
  message: Schema.String,
});
export const CompletedImageAction = m("CompletedImageAction");
export const StartedNoteReply = m("StartedNoteReply", { noteId: Schema.String });
export const RemovedNoteDraftTag = m("RemovedNoteDraftTag", { tag: Schema.String });
export const AskedNoteDelete = m("AskedNoteDelete", { noteId: Schema.String });
export const DismissedNoteDelete = m("DismissedNoteDelete");
export const ConfirmedNoteDelete = m("ConfirmedNoteDelete", { noteId: Schema.String });
/** A `[[n]]` reference in a posted note, followed to the note it names. */
export const FollowedNoteReference = m("FollowedNoteReference", { seq: Schema.Number });
export const ChangedNotesScope = m("ChangedNotesScope", { scope: NotesScopeKind });
export const ChangedNoteFilterInput = m("ChangedNoteFilterInput", { value: Schema.String });
export const AddedNoteFilterTerm = m("AddedNoteFilterTerm", { term: NoteFilterTerm });
export const ToggledNoteFilterTerm = m("ToggledNoteFilterTerm", { key: Schema.String });
export const RemovedNoteFilterTerm = m("RemovedNoteFilterTerm", { key: Schema.String });
export const ToggledNoteFilterMode = m("ToggledNoteFilterMode");
export const ClearedNoteFilters = m("ClearedNoteFilters");

export const NotesMessage = Schema.Union([
  StartedNote,
  StartedNoteEdit,
  ChangedNoteComposer,
  CancelledNoteComposer,
  AttachedNoteHighlight,
  FocusedNoteHighlight,
  SubmittedNoteOperation,
  SelectedNoteImage,
  UploadedNoteImage,
  FailedNoteImageUpload,
  CompletedImageAction,
  StartedNoteReply,
  RemovedNoteDraftTag,
  AskedNoteDelete,
  DismissedNoteDelete,
  ConfirmedNoteDelete,
  FollowedNoteReference,
  ChangedNotesScope,
  ChangedNoteFilterInput,
  AddedNoteFilterTerm,
  ToggledNoteFilterTerm,
  RemovedNoteFilterTerm,
  ToggledNoteFilterMode,
  ClearedNoteFilters,
  RetriedNoteImage,
  RemovedNoteImage,
  ConnectedNoteAgent,
  FailedNoteAgentConnection,
  ReleasedNoteAgent,
  StampedNoteAgentIdentity,
  ChangedNoteAgentStatus,
  ChangedNoteAgentPresence,
  ChangedNotes,
  RejectedNoteOperations,
  FailedNoteFlush,
  QueuedNoteOperation,
  DroppedNoteOperation,
  ChangedNoteDraft,
  ChangedNoteDraftSelection,
  ExtractedNoteDraftTags,
  FailedNoteEditor,
  PastedNoteImage,
]);
export type NotesMessage = typeof NotesMessage.Type;

export const isNotesMessage = Schema.is(NotesMessage);

export const EnqueueNoteOperation = Command.define("EnqueueNoteOperation", {
  args: { op: NoteOp },
  messages: [QueuedNoteOperation, DroppedNoteOperation],
  execute: ({ op }) => enqueueNoteOperation(op),
});

/**
 * The upload rides the generated client on the shared contract. The file is
 * handed over as a multipart part rather than as bytes, so the browser streams
 * it from disk and the whole image never lands in the Model.
 */
export const UploadNoteImage = Command.define("UploadNoteImage", {
  args: { groupRef: Schema.String, token: Schema.String, file: FoldkitFile.File },
  messages: [UploadedNoteImage, FailedNoteImageUpload],
  execute: ({ groupRef, token, file }) => {
    const payload = new FormData();
    payload.append(UPLOAD_FILE_FIELD, file);
    return bookclubClient.pipe(
      Effect.flatMap((client) => client.groups.uploadImage({ params: { groupRef }, payload })),
      Effect.map(({ id }) => UploadedNoteImage({ token, imageId: id })),
      Effect.catch((error) =>
        Effect.succeed(FailedNoteImageUpload({ token, message: String(error) })),
      ),
    );
  },
});

/** The image shows in the document while its bytes are still going up, so the
 *  editor is told about it before the upload starts. */
export const ShowPendingNoteImage = Command.define("ShowPendingNoteImage", {
  args: { token: Schema.String, file: FoldkitFile.File },
  messages: [CompletedImageAction],
  execute: ({ token, file }) =>
    noteEditor.insertPendingImage(token, file).pipe(Effect.as(CompletedImageAction())),
});

export const ResolveNoteImage = Command.define("ResolveNoteImage", {
  args: { token: Schema.String, imageId: Schema.String },
  messages: [CompletedImageAction],
  execute: ({ token, imageId }) =>
    noteEditor.resolvePendingImage(token, imageId).pipe(Effect.as(CompletedImageAction())),
});

export const MarkNoteImageFailed = Command.define("MarkNoteImageFailed", {
  args: { token: Schema.String },
  messages: [CompletedImageAction],
  execute: ({ token }) =>
    noteEditor.failPendingImage(token).pipe(Effect.as(CompletedImageAction())),
});

/** An image dropped from the draft is deleted rather than left behind for a
 *  note that never arrives. */
export const DiscardNoteImage = Command.define("DiscardNoteImage", {
  args: { groupRef: Schema.String, imageId: Schema.String },
  messages: [CompletedImageAction, FailedNoteImageUpload],
  execute: ({ groupRef, imageId }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.groups.deleteImage({ params: { groupRef, imageId } })),
      Effect.as(CompletedImageAction()),
      Effect.catch(() => Effect.succeed(CompletedImageAction())),
    ),
});

export const initialNotesModel = (): NotesModel => ({
  ready: false,
  status: "syncing",
  connectionKey: null,
  notes: [],
  pendingNoteIds: [],
  failedNoteIds: [],
  pendingCount: 0,
  peers: [],
  draft: "",
  draftTags: [],
  draftHighlights: [],
  focusedNoteId: null,
  draftImageIds: [],
  unresolvedImages: 0,
  groupRef: null,
  draftFormat: { collapsed: true, bold: false, italic: false, highlight: false },
  uploadingImage: false,
  composerGeneration: 0,
  editingNoteId: null,
  composing: false,
  replyingToNoteId: null,
  confirmingDeleteNoteId: null,
  scope: "current-book",
  filterTerms: [],
  filterMode: "all",
  filterInput: "",
  error: null,
});

const opBody = (op: NoteOp): string => ("body" in op && typeof op.body === "string" ? op.body : "");

/** Uploads that the draft is no longer carrying are deleted rather than left
 *  behind for a note that never arrives. */
const discardDraftImages = (
  model: NotesModel,
  keptImageIds: readonly string[],
): readonly NotesCommand[] => {
  const groupRef = model.groupRef;
  if (groupRef === null) return [];
  const kept = new Set(keptImageIds);
  return model.draftImageIds
    .filter((imageId) => !kept.has(imageId))
    .map((imageId) => DiscardNoteImage({ groupRef, imageId }));
};

const clearComposer = (model: NotesModel): NotesModel => ({
  ...model,
  draft: "",
  draftTags: [],
  draftHighlights: [],
  draftImageIds: [],
  unresolvedImages: 0,
  composerGeneration: model.composerGeneration + 1,
  editingNoteId: null,
  replyingToNoteId: null,
  composing: false,
});

const withTags = (existing: readonly string[], added: readonly string[]): readonly string[] => [
  ...new Set([...existing, ...added]),
];

/**
 * A highlight carries a fresh id every time the reader publishes a selection, so
 * identity has to come from where it points rather than from the id.
 */
const anchorKey = (anchor: HighlightAnchor): string =>
  anchor.kind === "epub-cfi" ? `epub:${anchor.value}` : `pdf:${anchor.page}`;

export type NotesCommand =
  | ReturnType<typeof EnqueueNoteOperation>
  | ReturnType<typeof UploadNoteImage>
  | ReturnType<typeof ShowPendingNoteImage>
  | ReturnType<typeof ResolveNoteImage>
  | ReturnType<typeof MarkNoteImageFailed>
  | ReturnType<typeof DiscardNoteImage>;

export const updateNotes = (
  model: NotesModel,
  message: NotesMessage,
): readonly [NotesModel, readonly NotesCommand[]] => {
  switch (message._tag) {
    case "StartedNote":
      // Uploads the abandoned draft was holding have no note to belong to.
      return [{ ...clearComposer(model), composing: true }, discardDraftImages(model, [])];
    case "CancelledNoteComposer":
      return [clearComposer(model), discardDraftImages(model, [])];
    case "StartedNoteReply":
      return [
        { ...clearComposer(model), replyingToNoteId: message.noteId },
        discardDraftImages(model, []),
      ];
    case "RemovedNoteDraftTag":
      return [{ ...model, draftTags: model.draftTags.filter((tag) => tag !== message.tag) }, []];
    case "AskedNoteDelete":
      return [{ ...model, confirmingDeleteNoteId: message.noteId }, []];
    case "DismissedNoteDelete":
      return [{ ...model, confirmingDeleteNoteId: null }, []];
    case "ConfirmedNoteDelete":
      return [
        { ...model, confirmingDeleteNoteId: null },
        [EnqueueNoteOperation({ op: removeNoteOp(message.noteId) })],
      ];
    case "FollowedNoteReference":
      return [
        {
          ...model,
          focusedNoteId:
            model.notes.find((note) => note.seq === message.seq)?.id ?? model.focusedNoteId,
        },
        [],
      ];
    case "ChangedNotesScope":
      return [{ ...model, scope: message.scope }, []];
    case "ChangedNoteFilterInput":
      return [{ ...model, filterInput: message.value }, []];
    case "AddedNoteFilterTerm": {
      const key = filterTermKey(message.term);
      if (model.filterTerms.some((term) => filterTermKey(term) === key)) return [model, []];
      // Filtering by book is only answerable once the panel is looking at them all.
      const scope =
        message.term.kind === "property" && message.term.property === "book"
          ? "all-books"
          : model.scope;
      return [
        { ...model, scope, filterInput: "", filterTerms: [...model.filterTerms, message.term] },
        [],
      ];
    }
    case "ToggledNoteFilterTerm":
      return [
        {
          ...model,
          filterTerms: model.filterTerms.map((term) =>
            filterTermKey(term) === message.key ? { ...term, negated: !term.negated } : term,
          ),
        },
        [],
      ];
    case "RemovedNoteFilterTerm":
      return [
        {
          ...model,
          filterTerms: model.filterTerms.filter((term) => filterTermKey(term) !== message.key),
        },
        [],
      ];
    case "ToggledNoteFilterMode":
      return [{ ...model, filterMode: model.filterMode === "all" ? "any" : "all" }, []];
    case "ClearedNoteFilters":
      return [{ ...model, filterTerms: [] }, []];
    case "StartedNoteEdit":
      return [
        {
          ...model,
          draft: message.body,
          draftTags: message.tags,
          draftHighlights: message.highlights,
          draftImageIds: [],
          composerGeneration: model.composerGeneration + 1,
          editingNoteId: message.noteId,
          replyingToNoteId: null,
          composing: false,
        },
        [],
      ];
    case "ChangedNoteDraft":
      return [
        {
          ...model,
          draft: message.body,
          draftImageIds: message.imageIds,
          unresolvedImages: message.unresolvedImages,
          groupRef: message.groupRef,
        },
        [],
      ];
    case "ExtractedNoteDraftTags":
      return [{ ...model, draftTags: withTags(model.draftTags, message.tags) }, []];
    case "ChangedNoteDraftSelection":
      return [
        {
          ...model,
          draftFormat: {
            collapsed: message.collapsed,
            bold: message.bold,
            italic: message.italic,
            highlight: message.highlight,
          },
        },
        [],
      ];
    case "FailedNoteEditor":
      return [{ ...model, error: message.message }, []];
    case "SelectedNoteImage":
    case "PastedNoteImage": {
      // The image is part of the document from the moment it is chosen; the
      // token is what ties the upload's outcome back to it.
      const token = crypto.randomUUID();
      return [
        { ...model, uploadingImage: true, error: null },
        [
          ShowPendingNoteImage({ token, file: message.file }),
          UploadNoteImage({ groupRef: message.groupRef, token, file: message.file }),
        ],
      ];
    }
    case "RetriedNoteImage":
      return [
        { ...model, uploadingImage: true, error: null },
        [UploadNoteImage({ groupRef: message.groupRef, token: message.token, file: message.file })],
      ];
    case "UploadedNoteImage":
      // The editor holds the image already, so settling the upload is a write
      // to the node rather than a rebuild of the composer.
      return [
        {
          ...model,
          uploadingImage: false,
          draftImageIds: [...model.draftImageIds, message.imageId],
        },
        [ResolveNoteImage({ token: message.token, imageId: message.imageId })],
      ];
    case "FailedNoteImageUpload":
      return [
        { ...model, uploadingImage: false, error: message.message },
        [MarkNoteImageFailed({ token: message.token })],
      ];
    case "RemovedNoteImage":
      return [
        {
          ...model,
          draftImageIds: model.draftImageIds.filter((id) => id !== message.imageId),
          uploadingImage: false,
        },
        message.imageId === ""
          ? []
          : [DiscardNoteImage({ groupRef: message.groupRef, imageId: message.imageId })],
      ];
    case "CompletedImageAction":
      return [model, []];
    case "AttachedNoteHighlight":
      // React carries the passage into the composer as a blockquote and keeps
      // the highlight itself out of sight, so a second selection replaces the
      // first rather than stacking beside it.
      return model.draftHighlights.some(
        (highlight) => anchorKey(highlight.anchor) === anchorKey(message.highlight.anchor),
      )
        ? [{ ...model, composing: true }, []]
        : [
            {
              ...model,
              composing: true,
              draft: `${blockquote(message.highlight.quote.exact)}\n\n`,
              draftHighlights: [message.highlight],
              composerGeneration: model.composerGeneration + 1,
            },
            [],
          ];
    case "FocusedNoteHighlight": {
      // The reader points at a highlight; the note that carries it is the one
      // the list should be showing.
      const focused =
        message.highlightId === null
          ? null
          : (model.notes.find((note) =>
              note.highlights.some((highlight) => highlight.id === message.highlightId),
            )?.id ?? null);
      return [{ ...model, focusedNoteId: focused }, []];
    }
    case "ChangedNoteComposer":
      return [
        {
          ...model,
          draft: message.body,
          draftTags: message.tags,
          draftHighlights: message.highlights,
        },
        [],
      ];
    case "SubmittedNoteOperation":
      return [
        clearComposer(model),
        [
          EnqueueNoteOperation({ op: message.op }),
          // Images the reader took back out before posting are not kept.
          ...discardDraftImages(model, [...noteImageIds(opBody(message.op))]),
        ],
      ];
    case "ChangedNoteAgentStatus":
      return [{ ...model, status: message.status }, []];
    case "ChangedNoteAgentPresence":
      return [{ ...model, peers: message.peers }, []];
    case "ChangedNotes":
      return [
        {
          ...model,
          ready: message.ready,
          notes: message.notes,
          pendingNoteIds: message.pendingNoteIds,
          failedNoteIds: message.failedNoteIds,
          pendingCount: message.pendingCount,
        },
        [],
      ];
    case "FailedNoteAgentConnection":
      return [{ ...model, status: "offline", connectionKey: null, error: message.reason }, []];
    case "FailedNoteFlush":
    case "DroppedNoteOperation":
      return [{ ...model, status: "offline", error: message.reason }, []];
    case "RejectedNoteOperations":
      return [{ ...model, error: `${message.count} note operation rejected` }, []];
    case "ReleasedNoteAgent":
      return [{ ...model, status: "offline", connectionKey: null, peers: [] }, []];
    case "ConnectedNoteAgent":
      return [{ ...model, connectionKey: message.groupId }, []];
    case "QueuedNoteOperation":
    case "StampedNoteAgentIdentity":
      return [model, []];
  }
};

/** Every highlight the reader should be painting for a source: the committed
 *  ones carried by live notes, plus the ones on the note being composed. */
export const notesHighlights = (
  model: NotesModel,
  sourceId: string,
): readonly { id: string; anchor: Highlight["anchor"] }[] =>
  [
    ...model.notes.filter((note) => note.deletedAt === null).flatMap((note) => note.highlights),
    ...model.draftHighlights,
  ]
    .filter((highlight) => highlight.sourceId === sourceId)
    .map((highlight) => ({ id: highlight.id, anchor: highlight.anchor }));

export interface ReaderSelection {
  readonly anchor: HighlightAnchor;
  readonly quote: QuoteSelector;
}

/** A note author's picture, already resolved to a URL (or null, in which case
 *  `initials` show on black). The panel stays ignorant of how avatars are
 *  stored, exactly as React's `AvatarResolver` does. */
export interface AuthorAvatar {
  readonly url: string | null;
  readonly initials: string;
  readonly name: string;
}

export interface NotesViewContext<Message = never> {
  readonly sourceId: string;
  readonly groupRef: string;
  /** What "show me this passage" means to the caller. Notes know which anchor a
   *  note stands on; only the workspace knows what reading it looks like. */
  readonly jumpToHighlight?: (anchor: HighlightAnchor) => Message;
  /** Who is reading, which is what decides whether a note offers edit and
   *  delete. Without one the panel is read-only. */
  readonly viewer?: NoteViewer;
  /** Whether the club accepts writes at all; defaults to the notes being ready. */
  readonly canWrite?: boolean;
  /** Avatars are the workspace's to resolve; with no resolver the rows render
   *  without the gutter, as React's do for info cards. */
  readonly avatarFor?: (author: NoteAuthor) => AuthorAvatar | null;
  /** Book titles for the ids notes carry, for the "all books" scope and the
   *  book filter chips. */
  readonly bookTitles?: ReadonlyMap<string, string>;
}

/** The reader hands over the anchor and the quote context; the note it becomes
 *  is the notes slice's to name. */
export const selectionHighlight = (sourceId: string, selection: ReaderSelection): Highlight => ({
  id: crypto.randomUUID(),
  sourceId,
  anchor: selection.anchor,
  quote: selection.quote,
  createdAt: new Date().toISOString(),
});

/** A highlight committed on its own is a note whose body is the marked quote,
 *  tagged so the reader can tell it from a written note. */
export const highlightNoteOp = (sourceId: string, highlight: Highlight): NoteOp =>
  addNoteOp(sourceId, highlightMark(highlight.quote.exact), [highlight], [HIGHLIGHT_TAG]);

/** Past this depth a reply keeps its place in the thread but stops being
 *  indented further, or the column runs out of room. */
const MAX_INDENT = 4;

const visibleTags = (tags: readonly string[] | undefined): readonly string[] =>
  (tags ?? []).filter((tag) => !isHiddenTag(tag));

const EMPTY_BOOK_TITLES: ReadonlyMap<string, string> = new Map();

export const notesView = <Message>(
  model: NotesModel,
  context: NotesViewContext<Message>,
  h: HtmlBuilder<Message | NotesMessage>,
): Html => {
  const { sourceId, groupRef, jumpToHighlight, viewer, avatarFor } = context;
  const canWrite = context.canWrite ?? model.ready;
  const bookTitles = context.bookTitles ?? EMPTY_BOOK_TITLES;
  const imageUrlBase = `/groups/${groupRef}/images`;
  const query = noteQueryOf(model.filterTerms, model.filterMode);
  const { conversation, contextIds } = filterConversation(
    model.notes,
    notesScopeOf(model.scope, sourceId),
    query,
  );
  const queryContext = noteQueryContextOf(model.notes, bookTitles);
  const references = new Map(model.notes.map((note) => [note.seq, noteSnippet(note)] as const));
  const showBookTitles = model.scope === "all-books";
  const loading = !model.ready;
  const drafting = model.composing || model.draft !== "" || model.draftHighlights.length > 0;
  const composing = drafting && model.editingNoteId === null && model.replyingToNoteId === null;
  const tagsView = (
    tags: readonly string[],
    options: { readonly editable: boolean; readonly filterable: boolean },
  ): Html => {
    const shown = visibleTags(tags);
    if (shown.length === 0) return null;
    return h.div(
      [h.Class(options.editable ? "note-tags note-tags--editable" : "note-tags")],
      shown.map((tag) =>
        h.span(
          [h.Key(tag), h.Class("note-tag")],
          [
            h.button(
              [
                h.Type("button"),
                h.Title(`Filter by ${tag}`),
                ...(options.filterable
                  ? [
                      h.OnClick(
                        AddedNoteFilterTerm({ term: { kind: "tag", value: tag, negated: false } }),
                      ),
                    ]
                  : []),
              ],
              [tag],
            ),
            ...(options.editable && !isReservedTag(tag)
              ? [
                  h.button(
                    [
                      h.Type("button"),
                      h.Class("note-tag-remove"),
                      h.AriaLabel(`Remove #${tag}`),
                      h.OnClick(RemovedNoteDraftTag({ tag })),
                    ],
                    ["×"],
                  ),
                ]
              : []),
          ],
        ),
      ),
    );
  };

  const composerView = (label: string, op: NoteOp, target: string): Html =>
    h.div(
      [h.Class("note-editor")],
      [
        ...(visibleTags(model.draftTags).length === 0
          ? []
          : [
              h.div(
                [h.Class("note-editor-header")],
                [tagsView(model.draftTags, { editable: true, filterable: false })],
              ),
            ]),
        h.div([
          h.Id("note-body"),
          // The Mount is re-seeded from the Model only on the transitions that
          // change what it should be holding, never on what the reader typed.
          h.Key(`composer:${target}:${model.composerGeneration}`),
          h.OnMount(
            NoteDraftEditor({
              initialBody: model.draft,
              validSeqs: model.notes.map((note) => note.seq),
              groupRef,
              imageUrlBase,
              extractHashtags: true,
            }),
          ),
        ]),
        ...(model.unresolvedImages === 0
          ? []
          : [
              h.p(
                [h.Class("note-editor-hint"), h.Role("status")],
                ["Finish or remove image uploads before saving."],
              ),
            ]),
        h.div(
          [h.Class("note-editor-actions")],
          [
            ...(model.uploadingImage
              ? [h.span([h.Class("note-editor-hint"), h.Role("status")], ["Uploading image"])]
              : []),
            h.button(
              [
                h.Type("button"),
                h.Class("primary"),
                h.Title(`${label} (⌘↵)`),
                // An image that has not settled carries no id to write into the
                // note, so the draft waits for it either way.
                h.Disabled(!canWrite || model.draft.trim() === "" || model.unresolvedImages > 0),
                h.OnClick(SubmittedNoteOperation({ op })),
              ],
              [label],
            ),
            h.button(
              [h.Type("button"), h.Title("Cancel"), h.OnClick(CancelledNoteComposer())],
              ["Cancel"],
            ),
          ],
        ),
      ],
    );

  const authorPicView = (avatar: AuthorAvatar): Html =>
    h.span(
      [h.Class("note-avatar"), h.Title(avatar.name)],
      [
        avatar.url === null
          ? h.span([h.AriaHidden(true)], [avatar.initials])
          : h.img([h.Src(avatar.url), h.Alt("")]),
      ],
    );

  /** Chat-style row: the author's picture floats to the left of the card and
   *  everything else shares one column, so an inline editor stays aligned to
   *  the avatar's gutter. */
  const withAvatar = (note: Note, content: Html): Html => {
    const avatar = avatarFor?.(note.author) ?? null;
    return avatar === null
      ? content
      : h.div(
          [h.Key(note.id), h.Class("note-row")],
          [authorPicView(avatar), h.div([h.Class("note-row-body")], [content])],
        );
  };

  const jumpView = (note: Note): Html => {
    const highlight = effectiveHighlight(note, conversation.byId);
    const anchored = highlight !== null && jumpToHighlight !== undefined;
    return h.button(
      [
        h.Type("button"),
        h.Class("quote truncate"),
        h.Disabled(!anchored),
        ...(anchored && highlight !== null && jumpToHighlight !== undefined
          ? [h.Title("Jump to highlight"), h.OnClick(jumpToHighlight(highlight.anchor))]
          : []),
      ],
      [noteTitle(note)],
    );
  };

  const syncView = (note: Note): readonly Html[] => {
    const failed = model.failedNoteIds.includes(note.id);
    if (!failed && !model.pendingNoteIds.includes(note.id)) return [];
    return [
      h.span(
        [
          h.Class(failed ? "note-sync note-sync--failed" : "note-sync note-sync--pending"),
          h.Title(
            failed
              ? "This change couldn't sync and was skipped"
              : "Not yet synced — will send when you reconnect",
          ),
        ],
        [failed ? "⚠ unsynced" : "• syncing"],
      ),
    ];
  };

  const deleteView = (note: Note): Html =>
    h.div(
      [h.Class("delete-wrap")],
      [
        h.button(
          [
            h.Type("button"),
            h.Class("delete"),
            h.AriaLabel("delete"),
            h.Title("Delete"),
            h.AriaExpanded(model.confirmingDeleteNoteId === note.id),
            h.Disabled(!canWrite),
            h.OnClick(AskedNoteDelete({ noteId: note.id })),
          ],
          ["✕"],
        ),
        ...(model.confirmingDeleteNoteId === note.id
          ? [
              h.dialog(
                [h.Class("delete-confirm"), h.Open(true), h.AriaLabel("Confirm delete")],
                [
                  h.p([], ["Really delete?"]),
                  h.div(
                    [h.Class("delete-confirm-actions")],
                    [
                      h.button(
                        [
                          h.Type("button"),
                          h.AriaLabel("cancel delete"),
                          h.Title("Keep note"),
                          h.OnClick(DismissedNoteDelete()),
                        ],
                        ["✕"],
                      ),
                      h.span([], ["|"]),
                      h.button(
                        [
                          h.Type("button"),
                          h.AriaLabel("confirm delete"),
                          h.Title("Delete note"),
                          h.Disabled(!canWrite),
                          h.OnClick(ConfirmedNoteDelete({ noteId: note.id })),
                        ],
                        ["✓"],
                      ),
                    ],
                  ),
                ],
              ),
            ]
          : []),
      ],
    );

  const noteActionsView = (note: Note, deleted: boolean): readonly Html[] => [
    ...syncView(note),
    ...(deleted
      ? []
      : [
          h.button(
            [
              h.Type("button"),
              h.Class("reply"),
              h.AriaLabel("reply"),
              h.Title("Reply"),
              h.OnClick(StartedNoteReply({ noteId: note.id })),
            ],
            ["↩"],
          ),
        ]),
    ...(!deleted && viewer !== undefined && canEditNote(note, viewer)
      ? [
          h.button(
            [
              h.Type("button"),
              h.Class("edit"),
              h.AriaLabel("edit"),
              h.Title("Edit"),
              h.OnClick(
                StartedNoteEdit({
                  noteId: note.id,
                  body: note.body,
                  tags: note.tags ?? [],
                  highlights: note.highlights,
                }),
              ),
            ],
            [h.img([h.Src(editIcon), h.Alt(""), h.AriaHidden(true)])],
          ),
        ]
      : []),
    ...(!deleted && viewer !== undefined && canDeleteNote(note, viewer) ? [deleteView(note)] : []),
  ];

  const noteCardView = (note: Note, deleted: boolean): Html =>
    h.div(
      [h.Class(deleted ? "note note--deleted" : "note"), h.Id(`note-${note.seq}`)],
      [
        h.div(
          [h.Class("note-header")],
          [
            h.div(
              [h.Class("note-head")],
              [
                h.span([h.Class("note-seq")], [String(note.seq)]),
                jumpView(note),
                ...noteActionsView(note, deleted),
              ],
            ),
          ],
        ),
        ...(visibleTags(note.tags).length === 0
          ? []
          : [
              h.div(
                [h.Class("note-card-tags")],
                [tagsView(note.tags ?? [], { editable: false, filterable: true })],
              ),
            ]),
        ...(note.body === ""
          ? []
          : [
              noteBodyView(
                note.body,
                {
                  refs: references,
                  onReference: (seq: number) => FollowedNoteReference({ seq }),
                  imageUrlBase,
                },
                h,
              ),
            ]),
      ],
    );

  const noteRowView = (note: Note): Html => {
    const deleted = note.deletedAt !== null;
    if (!deleted && model.editingNoteId === note.id) {
      return withAvatar(
        note,
        h.div(
          [h.Key(note.id), h.Class("note editing"), h.Id(`note-${note.seq}`)],
          [
            h.div(
              [h.Class("note-head")],
              [
                h.span([h.Class("note-seq")], [String(note.seq)]),
                h.button(
                  [h.Type("button"), h.Class("quote truncate"), h.Disabled(true)],
                  [`${noteTitle(note)} (editing)`],
                ),
              ],
            ),
            composerView(
              "Save",
              editNoteOp(note.id, model.draft, [...model.draftTags]),
              `edit:${note.id}`,
            ),
          ],
        ),
      );
    }
    return withAvatar(
      note,
      h.div(
        [
          h.Key(note.id),
          h.Class(contextIds.has(note.id) ? "note-result note-result--context" : "note-result"),
          ...(model.focusedNoteId === note.id ? [h.AriaCurrent("true")] : []),
        ],
        [
          noteCardView(note, deleted),
          ...(showBookTitles
            ? [
                h.div(
                  [h.Class("note-metadata")],
                  [
                    h.button(
                      [
                        h.Type("button"),
                        h.Class("note-book-property"),
                        h.Title("Filter by book"),
                        h.OnClick(
                          AddedNoteFilterTerm({
                            term: {
                              kind: "property",
                              property: "book",
                              value: note.sourceId,
                              negated: false,
                            },
                          }),
                        ),
                      ],
                      [bookTitles.get(note.sourceId) ?? "Untitled book"],
                    ),
                  ],
                ),
              ]
            : []),
          ...(!deleted && model.replyingToNoteId === note.id
            ? [
                h.div(
                  [h.Class("note reply-compose")],
                  [
                    composerView(
                      "Reply",
                      addReplyOp(note.sourceId, note.id, model.draft, [...model.draftTags]),
                      `reply:${note.id}`,
                    ),
                  ],
                ),
              ]
            : []),
        ],
      ),
    );
  };

  const repliesView = (parent: Note, depth: number): readonly Html[] => {
    const children = conversation.childrenOf(parent.id);
    if (children.length === 0) return [];
    const content = children.flatMap((child) => [
      noteRowView(child),
      ...repliesView(child, depth + 1),
    ]);
    return depth <= MAX_INDENT
      ? [h.div([h.Key(`replies:${parent.id}`), h.Class("replies")], content)]
      : content;
  };

  const activeKeys = new Set(model.filterTerms.map(filterTermKey));
  const needle = model.filterInput.trim().toLocaleLowerCase("en-US").replace(/^#/u, "");
  const suggestions = noteFilterSuggestions(model.notes, queryContext)
    .filter(
      (suggestion) =>
        !activeKeys.has(filterTermKey(suggestion.term)) &&
        (needle === "" || suggestion.label.toLocaleLowerCase("en-US").includes(needle)),
    )
    .slice(0, 12);
  const freeformTag = normalizeTag(model.filterInput);

  const enteredFilter = (key: string): Option.Option<NotesMessage> => {
    if (key !== "Enter") return Option.none();
    const first = suggestions[0];
    if (first !== undefined) return Option.some(AddedNoteFilterTerm({ term: first.term }));
    return freeformTag === null
      ? Option.none()
      : Option.some(
          AddedNoteFilterTerm({ term: { kind: "tag", value: freeformTag, negated: false } }),
        );
  };

  const suggestionsView = (): Html =>
    h.div(
      [h.Class("note-filter-suggestions")],
      [
        ...suggestions.map((suggestion) =>
          h.button(
            [
              h.Key(`${suggestion.group}:${filterTermKey(suggestion.term)}`),
              h.Type("button"),
              h.OnClick(AddedNoteFilterTerm({ term: suggestion.term })),
            ],
            [
              h.span([], [suggestion.group]),
              `${suggestion.label} `,
              h.small([], [String(suggestion.count)]),
            ],
          ),
        ),
        ...(freeformTag !== null &&
        !suggestions.some((suggestion) => suggestion.label === freeformTag)
          ? [
              h.button(
                [
                  h.Key("create"),
                  h.Type("button"),
                  h.OnClick(
                    AddedNoteFilterTerm({
                      term: { kind: "tag", value: freeformTag, negated: false },
                    }),
                  ),
                ],
                [h.span([], ["Tags"]), `Create ${freeformTag} filter`],
              ),
            ]
          : []),
      ],
    );

  const filterBarView = (): Html =>
    h.div(
      [
        h.Class(
          model.filterTerms.length > 0
            ? "note-filter-bar note-filter-bar--active"
            : "note-filter-bar",
        ),
      ],
      [
        h.div(
          [h.Class("note-scope"), h.AriaLabel("Notes scope")],
          [
            h.button(
              [
                h.Type("button"),
                h.Class(model.scope === "current-book" ? "active" : ""),
                h.OnClick(ChangedNotesScope({ scope: "current-book" })),
              ],
              ["This book"],
            ),
            h.button(
              [
                h.Type("button"),
                h.Class(model.scope === "all-books" ? "active" : ""),
                h.OnClick(ChangedNotesScope({ scope: "all-books" })),
              ],
              ["All books"],
            ),
          ],
        ),
        h.div(
          [h.Class("note-filter-terms")],
          [
            ...model.filterTerms.map((term) => {
              const key = filterTermKey(term);
              const label = filterTermLabel(term, queryContext);
              return h.span(
                [
                  h.Key(key),
                  h.Class(term.negated ? "note-filter-chip excluded" : "note-filter-chip"),
                ],
                [
                  h.button(
                    [
                      h.Type("button"),
                      h.Title("Include or exclude"),
                      h.OnClick(ToggledNoteFilterTerm({ key })),
                    ],
                    [`${term.negated ? "Not " : ""}${label}`],
                  ),
                  h.button(
                    [
                      h.Type("button"),
                      h.AriaLabel(`Remove ${label} filter`),
                      h.OnClick(RemovedNoteFilterTerm({ key })),
                    ],
                    ["×"],
                  ),
                ],
              );
            }),
            h.div(
              [h.Class("note-filter-entry")],
              [
                h.input([
                  h.Value(model.filterInput),
                  h.Placeholder("Filter"),
                  h.AriaLabel("Filter notes"),
                  h.OnInput((value) => ChangedNoteFilterInput({ value })),
                  h.OnKeyDownPreventDefault(enteredFilter),
                ]),
                ...(model.filterInput === "" ? [] : [suggestionsView()]),
              ],
            ),
            ...(model.filterTerms.length === 0
              ? []
              : [
                  h.div(
                    [h.Class("note-filter-status")],
                    [
                      ...(model.filterTerms.filter((term) => !term.negated).length > 1
                        ? [
                            h.button(
                              [h.Type("button"), h.OnClick(ToggledNoteFilterMode())],
                              [`Match ${model.filterMode}`],
                            ),
                          ]
                        : []),
                      h.button([h.Type("button"), h.OnClick(ClearedNoteFilters())], ["Clear"]),
                    ],
                  ),
                ]),
          ],
        ),
      ],
    );

  const loadingView = (): Html =>
    h.output(
      [h.Class("loading loading--note-panel"), h.AriaLive("polite"), h.AriaLabel("Loading")],
      [
        h.span(
          [h.Class("loading-text")],
          [
            "LOADING",
            h.span(
              [h.Class("loading-dots"), h.AriaHidden(true)],
              [h.span([], ["."]), h.span([], ["."]), h.span([], ["."])],
            ),
          ],
        ),
      ],
    );

  const roots = conversation.roots;
  return h.aside(
    [h.Class("note-panel")],
    [
      h.div(
        [h.Class("note-panel-toolbar")],
        [h.h2([h.Class("label")], ["Notes"]), filterBarView()],
      ),
      ...(loading && !composing ? [loadingView()] : []),
      ...(!loading && roots.length === 0 && !composing
        ? [
            h.p(
              [h.Class("empty")],
              [
                model.filterTerms.length > 0
                  ? "No notes match these filters."
                  : "Select text to add a note.",
              ],
            ),
          ]
        : []),
      h.ul(
        [],
        [
          ...(loading
            ? []
            : roots.map((root) =>
                h.li(
                  [h.Key(root.id), h.Class("note-thread")],
                  [noteRowView(root), ...repliesView(root, 1)],
                ),
              )),
          ...(composing
            ? [
                h.li(
                  [h.Key("compose"), h.Class("note compose")],
                  [
                    composerView(
                      "Publish",
                      addNoteOp(
                        sourceId,
                        model.draft,
                        [...model.draftHighlights],
                        [...model.draftTags],
                      ),
                      "compose",
                    ),
                  ],
                ),
              ]
            : []),
        ],
      ),
    ],
  );
};
