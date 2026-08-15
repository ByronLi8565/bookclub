import { Effect, Schema } from "effect";
import { Command } from "foldkit";
import * as FoldkitFile from "foldkit/file";
import type { Html, HtmlBuilder } from "foldkit/html";
import { m } from "foldkit/message";
import { UPLOAD_FILE_FIELD } from "../../shared/http/uploads.ts";
import { DEFAULT_NOTE_IMAGE_WIDTH, noteImageBlock } from "../../shared/notes/images.ts";
import {
  HIGHLIGHT_TAG,
  Highlight,
  Note,
  NoteOp,
  type HighlightAnchor,
  type QuoteSelector,
} from "../../shared/types/notes.ts";
import { highlightMark } from "../logic/notes/format.ts";
import { bookclubClient } from "../logic/net/bookclubClient.ts";
import { addNoteOp, editNoteOp, removeNoteOp } from "../logic/notes/noteOps.ts";
import {
  ChangedNoteDraft,
  ChangedNoteDraftSelection,
  ExtractedNoteDraftTags,
  FailedNoteEditor,
  NoteDraftEditor,
  PastedNoteImage,
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
export const DetachedNoteHighlight = m("DetachedNoteHighlight", { highlightId: Schema.String });
export const SubmittedNoteOperation = m("SubmittedNoteOperation", { op: NoteOp });
export const SelectedNoteImage = m("SelectedNoteImage", {
  groupRef: Schema.String,
  file: FoldkitFile.File,
});
export const UploadedNoteImage = m("UploadedNoteImage", { imageId: Schema.String });
export const FailedNoteImageUpload = m("FailedNoteImageUpload", { message: Schema.String });

export const NotesMessage = Schema.Union([
  StartedNote,
  StartedNoteEdit,
  ChangedNoteComposer,
  CancelledNoteComposer,
  AttachedNoteHighlight,
  FocusedNoteHighlight,
  DetachedNoteHighlight,
  SubmittedNoteOperation,
  SelectedNoteImage,
  UploadedNoteImage,
  FailedNoteImageUpload,
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
  args: { groupRef: Schema.String, file: FoldkitFile.File },
  messages: [UploadedNoteImage, FailedNoteImageUpload],
  execute: ({ groupRef, file }) => {
    const payload = new FormData();
    payload.append(UPLOAD_FILE_FIELD, file);
    return bookclubClient.pipe(
      Effect.flatMap((client) => client.groups.uploadImage({ params: { groupRef }, payload })),
      Effect.map(({ id }) => UploadedNoteImage({ imageId: id })),
      Effect.catch((error) => Effect.succeed(FailedNoteImageUpload({ message: String(error) }))),
    );
  },
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
  draftFormat: { collapsed: true, bold: false, italic: false, highlight: false },
  uploadingImage: false,
  composerGeneration: 0,
  editingNoteId: null,
  error: null,
});

const clearComposer = (model: NotesModel): NotesModel => ({
  ...model,
  draft: "",
  draftTags: [],
  draftHighlights: [],
  draftImageIds: [],
  composerGeneration: model.composerGeneration + 1,
  editingNoteId: null,
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

export const updateNotes = (
  model: NotesModel,
  message: NotesMessage,
): readonly [
  NotesModel,
  readonly (ReturnType<typeof EnqueueNoteOperation> | ReturnType<typeof UploadNoteImage>)[],
] => {
  switch (message._tag) {
    case "StartedNote":
    case "CancelledNoteComposer":
      return [clearComposer(model), []];
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
        },
        [],
      ];
    case "ChangedNoteDraft":
      return [{ ...model, draft: message.body, draftImageIds: message.imageIds }, []];
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
    case "PastedNoteImage":
      return [
        { ...model, uploadingImage: true, error: null },
        [UploadNoteImage({ groupRef: message.groupRef, file: message.file })],
      ];
    case "UploadedNoteImage": {
      const block = noteImageBlock({ id: message.imageId, width: DEFAULT_NOTE_IMAGE_WIDTH });
      const draft = model.draft === "" ? block : `${model.draft}\n\n${block}`;
      // The editor owns its own content, so an image appended to the draft only
      // appears once the Mount is rebuilt from the Model.
      return [
        {
          ...model,
          draft,
          uploadingImage: false,
          draftImageIds: [...model.draftImageIds, message.imageId],
          composerGeneration: model.composerGeneration + 1,
        },
        [],
      ];
    }
    case "FailedNoteImageUpload":
      return [{ ...model, uploadingImage: false, error: message.message }, []];
    case "AttachedNoteHighlight":
      return model.draftHighlights.some(
        (highlight) => anchorKey(highlight.anchor) === anchorKey(message.highlight.anchor),
      )
        ? [model, []]
        : [{ ...model, draftHighlights: [...model.draftHighlights, message.highlight] }, []];
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
    case "DetachedNoteHighlight":
      return [
        {
          ...model,
          draftHighlights: model.draftHighlights.filter(
            (highlight) => highlight.id !== message.highlightId,
          ),
        },
        [],
      ];
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
      return [clearComposer(model), [EnqueueNoteOperation({ op: message.op })]];
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

const noteThread = (notes: readonly Note[], parent: string | null): readonly Note[] =>
  notes.filter((note) => note.parent === parent && note.deletedAt === null);

export interface ReaderSelection {
  readonly anchor: HighlightAnchor;
  readonly quote: QuoteSelector;
}

export interface NotesViewContext<Message = never> {
  readonly sourceId: string;
  readonly groupRef: string;
  readonly selection: ReaderSelection | null;
  /** What "show me this passage" means to the caller. Notes know which anchor a
   *  note stands on; only the workspace knows what reading it looks like. */
  readonly jumpToHighlight?: (anchor: HighlightAnchor) => Message;
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

export const notesView = <Message>(
  model: NotesModel,
  { sourceId, groupRef, selection, jumpToHighlight }: NotesViewContext<Message>,
  h: HtmlBuilder<Message | NotesMessage>,
): Html => {
  const roots = noteThread(model.notes, null);
  const attachable =
    selection !== null &&
    !model.draftHighlights.some(
      (highlight) => anchorKey(highlight.anchor) === anchorKey(selection.anchor),
    );
  const composerOp = (): NoteOp =>
    model.editingNoteId === null
      ? addNoteOp(sourceId, model.draft, [...model.draftHighlights], [...model.draftTags])
      : editNoteOp(model.editingNoteId, model.draft, [...model.draftTags]);

  const noteItem = (note: Note): Html =>
    h.li(
      [
        h.Key(note.id),
        ...(model.focusedNoteId === note.id
          ? [h.Class("note is-focused"), h.AriaCurrent("true")]
          : [h.Class("note")]),
      ],
      [
        h.p([], [note.body]),
        ...(jumpToHighlight === undefined || note.highlights.length === 0
          ? []
          : [
              h.button(
                [
                  h.Type("button"),
                  h.OnClick(jumpToHighlight(note.highlights[0]!.anchor)),
                  h.Title("Show this passage in the book"),
                ],
                ["Show passage"],
              ),
            ]),
        h.p([h.Class("note-byline")], [note.author.name]),
        ...(model.pendingNoteIds.includes(note.id)
          ? [h.span([h.Role("status")], ["Sending"])]
          : []),
        ...(model.failedNoteIds.includes(note.id) ? [h.span([h.Role("alert")], ["Failed"])] : []),
        h.button(
          [
            h.OnClick(
              StartedNoteEdit({
                noteId: note.id,
                body: note.body,
                tags: note.tags ?? [],
                highlights: note.highlights,
              }),
            ),
          ],
          ["Edit"],
        ),
        h.button([h.OnClick(SubmittedNoteOperation({ op: removeNoteOp(note.id) }))], ["Delete"]),
        h.ul([], noteThread(model.notes, note.id).map(noteItem)),
      ],
    );

  return h.section(
    [h.AriaLabel("Notes")],
    [
      h.p(
        [h.Role("status")],
        [
          model.ready ? `${roots.length} notes` : "Loading notes",
          ` · ${model.status}`,
          model.pendingCount === 0 ? "" : ` · ${model.pendingCount} pending`,
        ],
      ),
      h.ul(
        [h.AriaLabel("Readers here")],
        model.peers.map((peer) => h.li([h.Key(peer.id)], [peer.name])),
      ),
      ...(model.error === null ? [] : [h.p([h.Role("alert")], [model.error])]),
      h.ul([h.AriaLabel("Notes")], roots.map(noteItem)),
      h.form(
        [h.OnSubmit(SubmittedNoteOperation({ op: composerOp() }))],
        [
          ...(attachable && selection !== null
            ? [
                h.button(
                  [
                    h.Type("button"),
                    h.OnClick(
                      AttachedNoteHighlight({ highlight: selectionHighlight(sourceId, selection) }),
                    ),
                  ],
                  ["Quote this passage"],
                ),
              ]
            : []),
          h.ul(
            [h.AriaLabel("Quoted passages")],
            model.draftHighlights.map((highlight) =>
              h.li(
                [h.Key(highlight.id)],
                [
                  h.blockquote([], [highlight.quote.exact]),
                  h.button(
                    [
                      h.Type("button"),
                      h.OnClick(DetachedNoteHighlight({ highlightId: highlight.id })),
                    ],
                    ["Remove quote"],
                  ),
                ],
              ),
            ),
          ),
          h.label([h.For("note-body")], [model.editingNoteId === null ? "New note" : "Edit note"]),
          h.div([
            h.Id("note-body"),
            h.Key(`composer:${model.composerGeneration}`),
            h.AriaLabel(model.editingNoteId === null ? "New note" : "Edit note"),
            h.OnMount(
              NoteDraftEditor({
                initialBody: model.draft,
                validSeqs: model.notes.map((note) => note.seq),
                groupRef,
                imageUrlBase: `/groups/${groupRef}/images`,
                extractHashtags: true,
              }),
            ),
          ]),
          h.label([h.For("note-image")], ["Add image"]),
          h.input([
            h.Id("note-image"),
            h.Type("file"),
            h.Accept("image/*"),
            h.Disabled(model.uploadingImage),
            h.OnFileChange((files) =>
              files[0] === undefined
                ? // Clearing the picker must leave the draft exactly as it was.
                  ChangedNoteComposer({
                    body: model.draft,
                    tags: model.draftTags,
                    highlights: model.draftHighlights,
                  })
                : SelectedNoteImage({ groupRef, file: files[0] }),
            ),
          ]),
          ...(model.uploadingImage ? [h.span([h.Role("status")], ["Uploading image"])] : []),
          h.button(
            [h.Type("submit"), h.Disabled(model.draft.trim() === "" || model.uploadingImage)],
            [model.editingNoteId === null ? "Post note" : "Save note"],
          ),
          ...(model.editingNoteId === null
            ? []
            : [h.button([h.OnClick(CancelledNoteComposer())], ["Cancel"])]),
        ],
      ),
    ],
  );
};
