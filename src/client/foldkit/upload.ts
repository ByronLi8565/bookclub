import { Effect, Option, Schema } from "effect";
import { Command } from "foldkit";
import * as FoldkitFile from "foldkit/file";
import type { Html, HtmlBuilder } from "foldkit/html";
import { m } from "foldkit/message";
import { formatBytes } from "../../shared/format.ts";
import { groupUrlName, type GroupUrlParts } from "../../shared/groupUrls.ts";
import { UPLOAD_FILE_FIELD } from "../../shared/http/uploads.ts";
import type { SourceHealth } from "../../shared/types/sourceHealth.ts";
import type { SourceInspection } from "../logic/sources/checkHealth.ts";
// The reader and the presence modal both import this outright, so it is in the
// bundle either way; loading it lazily here only split the graph on paper.
import { putCachedSource } from "../logic/groups/sourceCache.ts";
import { bookclubClient } from "../logic/net/bookclubClient.ts";
import { modalView } from "./modal.ts";

const ACCEPT = ".epub,application/epub+zip,.pdf,application/pdf";

/**
 * The Model stays JSON-serializable, so the chosen file never lands in it. It
 * rides a Message into a Command, is parked here under a token, and is read back
 * by the Command that finally sends the bytes. Only the token travels through
 * update, and a fresh choice replaces the previous file rather than piling up.
 */
const selectedFiles = new Map<string, File>();

const rememberSelectedFile = (token: string, file: File): void => {
  selectedFiles.clear();
  selectedFiles.set(token, file);
};

const BookCapabilities = Schema.Struct({
  selectableText: Schema.Boolean,
  textAnchors: Schema.Boolean,
  rectAnchors: Schema.Boolean,
  pageNavigation: Schema.Boolean,
});

const BookHealthIssue = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  page: Schema.NullOr(Schema.Number),
});

/**
 * `SourceHealth` is a union whose error arm carries no capabilities; flattened
 * here so the Model is one shape. An erroring book has no capabilities to show
 * and its issues read as problems, which is the only branch the rows care about.
 */
export const BookHealth = Schema.Struct({
  status: Schema.Literals(["ok", "warn", "error"]),
  capabilities: Schema.NullOr(BookCapabilities),
  issues: Schema.Array(BookHealthIssue),
});
export type BookHealth = typeof BookHealth.Type;

export const InspectedBook = Schema.Struct({
  token: Schema.String,
  fileName: Schema.String,
  fileSize: Schema.Number,
  kind: Schema.String,
  contentType: Schema.String,
  title: Schema.NullOr(Schema.String),
  author: Schema.NullOr(Schema.String),
  wordCount: Schema.NullOr(Schema.Number),
  cover: Schema.NullOr(Schema.String),
  health: BookHealth,
});
export type InspectedBook = typeof InspectedBook.Type;

export const UploadModel = Schema.Struct({
  status: Schema.Literals(["idle", "checking", "ready", "uploading"]),
  inspected: Schema.NullOr(InspectedBook),
  error: Schema.NullOr(Schema.String),
  progress: Schema.Number,
  dragging: Schema.Boolean,
  /** React's `RenamableText` keeps its own editing state; here the modal owns it
   *  so the title and author cells stay serializable. */
  editingField: Schema.NullOr(Schema.Literals(["title", "author"])),
  editDraft: Schema.String,
});
export type UploadModel = typeof UploadModel.Type;

export const initialUploadModel = (): UploadModel => ({
  status: "idle",
  inspected: null,
  error: null,
  progress: 0,
  dragging: false,
  editingField: null,
  editDraft: "",
});

export const DraggedOverBookDrop = m("DraggedOverBookDrop");
export const LeftBookDrop = m("LeftBookDrop");
export const SelectedBookFile = m("SelectedBookFile", { file: FoldkitFile.File });
export const CompletedBookInspection = m("CompletedBookInspection", { book: InspectedBook });
export const FailedBookInspection = m("FailedBookInspection", {
  reason: Schema.Literals(["unsupported_type", "read_failed"]),
});
export const ProgressedBookInspection = m("ProgressedBookInspection", { progress: Schema.Number });
export const StartedBookFieldEdit = m("StartedBookFieldEdit", {
  field: Schema.Literals(["title", "author"]),
});
export const ChangedBookFieldDraft = m("ChangedBookFieldDraft", { value: Schema.String });
export const CancelledBookFieldEdit = m("CancelledBookFieldEdit");
export const CommittedBookFieldEdit = m("CommittedBookFieldEdit");
export const SubmittedBookUpload = m("SubmittedBookUpload", { groupRef: Schema.String });
export const UploadedBook = m("UploadedBook", { sourceId: Schema.String });
export const FailedBookUpload = m("FailedBookUpload", { message: Schema.String });

export const UploadMessage = Schema.Union([
  DraggedOverBookDrop,
  LeftBookDrop,
  SelectedBookFile,
  CompletedBookInspection,
  FailedBookInspection,
  ProgressedBookInspection,
  StartedBookFieldEdit,
  ChangedBookFieldDraft,
  CancelledBookFieldEdit,
  CommittedBookFieldEdit,
  SubmittedBookUpload,
  UploadedBook,
  FailedBookUpload,
]);
export type UploadMessage = typeof UploadMessage.Type;

const uploadMessageTags: ReadonlySet<string> = new Set([
  "DraggedOverBookDrop",
  "LeftBookDrop",
  "SelectedBookFile",
  "CompletedBookInspection",
  "FailedBookInspection",
  "ProgressedBookInspection",
  "StartedBookFieldEdit",
  "ChangedBookFieldDraft",
  "CancelledBookFieldEdit",
  "CommittedBookFieldEdit",
  "SubmittedBookUpload",
  "UploadedBook",
  "FailedBookUpload",
]);

export const isUploadMessage = (message: { _tag: string }): message is UploadMessage =>
  uploadMessageTags.has(message._tag);

const healthIssue = (issue: {
  code: string;
  message: string;
  page?: number;
}): typeof BookHealthIssue.Type => ({
  code: issue.code,
  message: issue.message,
  page: issue.page ?? null,
});

const bookHealth = (health: SourceHealth): BookHealth =>
  health.status === "error"
    ? { status: "error", capabilities: null, issues: health.errors.map(healthIssue) }
    : {
        status: health.status,
        capabilities: health.capabilities,
        issues: health.status === "warn" ? health.warnings.map(healthIssue) : [],
      };

/**
 * The inspectors pull in the EPUB and PDF readers, so they are imported when a
 * book is actually chosen rather than when the modal's module is loaded.
 */
export const InspectBook = Command.define("InspectBook", {
  args: { token: Schema.String, file: FoldkitFile.File },
  messages: [CompletedBookInspection, FailedBookInspection],
  execute: ({ token, file }) =>
    Effect.promise(async (): Promise<SourceInspection> => {
      rememberSelectedFile(token, file);
      try {
        const { inspectSource } = await import("../logic/sources/checkHealth.ts");
        return await inspectSource(file);
      } catch {
        return { ok: false, reason: "read_failed" };
      }
    }).pipe(
      Effect.map((inspection) =>
        inspection.ok
          ? CompletedBookInspection({
              book: {
                token,
                fileName: file.name,
                fileSize: file.size,
                kind: inspection.kind,
                contentType: inspection.contentType,
                title: inspection.metadata.title,
                author: inspection.metadata.author,
                wordCount: inspection.metadata.wordCount,
                cover: inspection.metadata.cover,
                health: bookHealth(inspection.health),
              },
            })
          : FailedBookInspection({ reason: inspection.reason }),
      ),
    ),
});

/**
 * The book rides the generated client on the shared contract as a multipart
 * part, so the browser streams it from disk and the file never lands in the
 * Model. The reader opens the book straight after uploading it, so the bytes go
 * into the source cache rather than being fetched back down again.
 */
export const UploadBook = Command.define("UploadBook", {
  args: {
    groupRef: Schema.String,
    token: Schema.String,
    title: Schema.NullOr(Schema.String),
    author: Schema.NullOr(Schema.String),
    wordCount: Schema.NullOr(Schema.Number),
  },
  messages: [UploadedBook, FailedBookUpload],
  execute: ({ groupRef, token, title, author, wordCount }) => {
    const file = selectedFiles.get(token);
    if (file === undefined) {
      return Effect.succeed(FailedBookUpload({ message: "no_file" }));
    }
    const payload = new FormData();
    payload.append(UPLOAD_FILE_FIELD, file);
    // The metadata rides headers rather than the body so the part stays the file
    // itself, and a field the reader left empty is left off rather than sent blank.
    const headers: Record<string, string> = {};
    if (title !== null && title !== "") headers["x-source-title"] = encodeURIComponent(title);
    if (author !== null && author !== "") headers["x-source-author"] = encodeURIComponent(author);
    if (wordCount !== null) headers["x-source-word-count"] = String(wordCount);
    return bookclubClient.pipe(
      Effect.flatMap((client) =>
        client.groups.uploadBook({ params: { groupRef }, headers, payload }),
      ),
      Effect.flatMap(({ hash }) =>
        Effect.promise(async () => {
          try {
            await putCachedSource(hash, file);
          } catch {
            // A book that failed to cache is still uploaded; it downloads again.
          }
          return UploadedBook({ sourceId: hash });
        }),
      ),
      Effect.catch((error) => Effect.succeed(FailedBookUpload({ message: String(error) }))),
    );
  },
});

export type UploadCommand = ReturnType<typeof InspectBook> | ReturnType<typeof UploadBook>;

const isBusy = (model: UploadModel): boolean =>
  model.status === "checking" || model.status === "uploading";

export const canUploadBook = (model: UploadModel): boolean =>
  model.inspected !== null && model.inspected.health.status !== "error";

const fieldValue = (book: InspectedBook, field: "title" | "author"): string =>
  (field === "title" ? book.title : book.author) ?? "";

const withField = (
  book: InspectedBook,
  field: "title" | "author",
  value: string | null,
): InspectedBook => (field === "title" ? { ...book, title: value } : { ...book, author: value });

export const updateUpload = (
  model: UploadModel,
  message: UploadMessage,
): readonly [UploadModel, readonly UploadCommand[]] => {
  switch (message._tag) {
    case "DraggedOverBookDrop":
      return [{ ...model, dragging: true }, []];
    case "LeftBookDrop":
      return [{ ...model, dragging: false }, []];
    case "SelectedBookFile": {
      const token = crypto.randomUUID();
      return [
        {
          ...model,
          status: "checking",
          inspected: null,
          error: null,
          progress: 0,
          dragging: false,
          editingField: null,
          editDraft: "",
        },
        [InspectBook({ token, file: message.file })],
      ];
    }
    case "CompletedBookInspection":
      return [{ ...model, status: "ready", inspected: message.book, error: null }, []];
    case "FailedBookInspection":
      return [
        {
          ...model,
          status: "idle",
          inspected: null,
          error:
            message.reason === "unsupported_type"
              ? "Unsupported file — choose an EPUB or PDF."
              : "That file couldn't be read.",
        },
        [],
      ];
    case "ProgressedBookInspection":
      return [{ ...model, progress: message.progress }, []];
    case "StartedBookFieldEdit":
      return [
        {
          ...model,
          editingField: message.field,
          editDraft: model.inspected === null ? "" : fieldValue(model.inspected, message.field),
        },
        [],
      ];
    case "ChangedBookFieldDraft":
      return [{ ...model, editDraft: message.value }, []];
    case "CancelledBookFieldEdit":
      return [{ ...model, editingField: null, editDraft: "" }, []];
    case "CommittedBookFieldEdit": {
      const { inspected, editingField } = model;
      if (inspected === null || editingField === null) {
        return [{ ...model, editingField: null, editDraft: "" }, []];
      }
      const next = model.editDraft.trim();
      const unchanged = next === fieldValue(inspected, editingField);
      return [
        {
          ...model,
          inspected: unchanged
            ? inspected
            : withField(inspected, editingField, next === "" ? null : next),
          editingField: null,
          editDraft: "",
        },
        [],
      ];
    }
    case "SubmittedBookUpload": {
      const book = model.inspected;
      if (book === null || !canUploadBook(model) || isBusy(model)) return [model, []];
      return [
        { ...model, status: "uploading" },
        [
          UploadBook({
            groupRef: message.groupRef,
            token: book.token,
            title: book.title,
            author: book.author,
            wordCount: book.wordCount,
          }),
        ],
      ];
    }
    case "UploadedBook":
      // The book is stored; the club reloads and the modal closes on the host's
      // side, so what is left here is a modal ready to take the next book.
      return [initialUploadModel(), []];
    case "FailedBookUpload":
      return [{ ...model, status: "ready" }, []];
  }
};

interface InfoRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly editable?: "title" | "author";
  readonly placeholder?: string;
  readonly status?: "ok" | "warn" | "error";
}

const CAPABILITY_ROWS: readonly {
  readonly key: keyof typeof BookCapabilities.Type;
  readonly label: string;
}[] = [
  { key: "selectableText", label: "Selectable text" },
  { key: "textAnchors", label: "Text anchors" },
  { key: "rectAnchors", label: "Position anchors" },
  { key: "pageNavigation", label: "Page navigation" },
];

const healthRows = (health: BookHealth): readonly InfoRow[] => {
  if (health.status === "error") {
    return health.issues.map((issue) => ({
      key: `error:${issue.code}:${issue.page ?? "all"}`,
      label: "Problem",
      value: issue.message,
      status: "error" as const,
    }));
  }
  const capabilities = health.capabilities;
  return [
    ...(capabilities === null
      ? []
      : CAPABILITY_ROWS.map(({ key, label }) => ({
          key: `capability:${key}`,
          label,
          value: capabilities[key] ? "yes" : "no",
          status: capabilities[key] ? ("ok" as const) : ("error" as const),
        }))),
    ...health.issues.map((issue) => ({
      key: `warning:${issue.code}:${issue.page ?? "all"}`,
      label: "Warning",
      value: issue.message,
      status: "warn" as const,
    })),
  ];
};

const infoRows = (book: InspectedBook): readonly InfoRow[] => [
  {
    key: "title",
    label: "Title",
    value: book.title ?? "",
    editable: "title",
    placeholder: "untitled",
  },
  {
    key: "author",
    label: "Author",
    value: book.author ?? "",
    editable: "author",
    placeholder: "unknown",
  },
  ...(book.wordCount === null
    ? []
    : [{ key: "words", label: "Words", value: book.wordCount.toLocaleString() }]),
  { key: "size", label: "Size", value: formatBytes(book.fileSize) },
  ...healthRows(book.health),
];

/** React's `Loading`, which `shared.css` styles by class name and nothing else. */
const loadingView = <Message>(
  className: string,
  progress: number | undefined,
  h: HtmlBuilder<Message>,
): Html =>
  h.output(
    [h.Class(`loading ${className}`), h.AriaLive("polite"), h.AriaLabel("Loading")],
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
      ...(progress === undefined
        ? []
        : [
            h.span(
              [h.Class("loading-progress"), h.AriaHidden(true)],
              [
                h.span([
                  h.Class("loading-progress-fill"),
                  h.Style({ width: `${Math.max(0, Math.min(100, progress))}%` }),
                ]),
              ],
            ),
          ]),
    ],
  );

const uploadIcon = <Message>(h: HtmlBuilder<Message>): Html =>
  h.svg(
    [
      h.Class("upload-drop-icon"),
      h.Width("28"),
      h.Height("28"),
      h.ViewBox("0 0 16 16"),
      h.Fill("currentColor"),
      h.AriaHidden(true),
    ],
    [
      h.path(
        [
          h.D(
            "M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5",
          ),
        ],
        [],
      ),
      h.path(
        [
          h.D(
            "M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708z",
          ),
        ],
        [],
      ),
    ],
  );

export interface UploadViewContext<Message> {
  /** The club itself rather than a reference to it: the server resolves a club
   *  by the segment after the last `-`, so the reference is built here. */
  readonly group: GroupUrlParts;
  readonly onClose: Message;
}

export const uploadView = <Message>(
  model: UploadModel,
  { group, onClose }: UploadViewContext<Message>,
  h: HtmlBuilder<Message | UploadMessage>,
): Html => {
  const book = model.inspected;
  const busy = isBusy(model);
  const groupRef = groupUrlName(group);

  const editableCell = (row: InfoRow, field: "title" | "author"): Html =>
    model.editingField === field
      ? h.input([
          h.Class("upload-info-edit"),
          h.Autofocus(true),
          h.Value(model.editDraft),
          h.AriaLabel(row.label.toLowerCase()),
          ...(row.placeholder === undefined ? [] : [h.Placeholder(row.placeholder)]),
          h.OnInput((value) => ChangedBookFieldDraft({ value })),
          h.OnBlur(CommittedBookFieldEdit()),
          h.OnKeyDownPreventDefault((key) =>
            key === "Enter"
              ? Option.some(CommittedBookFieldEdit())
              : key === "Escape"
                ? Option.some(CancelledBookFieldEdit())
                : Option.none(),
          ),
        ])
      : h.span(
          [
            h.Title(`Double-click to edit ${row.label.toLowerCase()}`),
            h.OnDoubleClick(StartedBookFieldEdit({ field })),
          ],
          [row.value === "" ? (row.placeholder ?? "") : row.value],
        );

  const infoRow = (row: InfoRow): Html =>
    h.div(
      [h.Key(row.key), h.Class("upload-info-row")],
      [
        h.dt([], [row.label]),
        h.dd(row.status === undefined ? [] : [h.Class(`upload-status--${row.status}`)], [
          row.editable === undefined ? row.value : editableCell(row, row.editable),
        ]),
      ],
    );

  return modalView<Message | UploadMessage>(
    { title: "add a book", className: "modal--upload", onClose },
    h,
    [
      h.div(
        [h.Class("modal-body upload-body")],
        [
          h.label(
            [
              h.Class(model.dragging ? "upload-drop is-dragging" : "upload-drop"),
              h.OnDragOver(DraggedOverBookDrop()),
              h.OnDragLeave(LeftBookDrop()),
              h.OnDropFiles((files) =>
                files[0] === undefined ? LeftBookDrop() : SelectedBookFile({ file: files[0] }),
              ),
            ],
            [
              book !== null && book.cover !== null
                ? h.img([h.Class("upload-cover"), h.Src(book.cover), h.Alt("")])
                : uploadIcon(h),
              h.span(
                [h.Class("upload-drop-label")],
                [book === null ? "attach book here" : book.fileName],
              ),
              h.span([h.Class("upload-drop-hint")], ["supported filetypes: pdf, epub"]),
              h.input([
                h.Type("file"),
                h.Accept(ACCEPT),
                h.Disabled(busy),
                h.Hidden(true),
                h.OnFileChange((files) =>
                  // Clearing the picker must not throw the inspected book away.
                  files[0] === undefined ? LeftBookDrop() : SelectedBookFile({ file: files[0] }),
                ),
              ]),
            ],
          ),
          ...(model.error === null ? [] : [h.p([h.Class("upload-error")], [model.error])]),
          ...(model.status === "checking"
            ? [
                h.div(
                  [h.Class("upload-checking")],
                  [
                    loadingView("loading--inline", model.progress, h),
                    h.span([], ["checking whether highlights will work…"]),
                  ],
                ),
              ]
            : []),
          ...(book === null
            ? []
            : [
                h.div(
                  [h.Class("upload-info")],
                  [
                    h.h2([h.Class("upload-info-head")], ["upload info"]),
                    h.dl([h.Class("upload-info-table")], infoRows(book).map(infoRow)),
                  ],
                ),
              ]),
          h.div(
            [h.Class("upload-actions")],
            [
              h.button(
                [
                  h.Type("button"),
                  h.Class("primary upload-submit"),
                  h.Disabled(!canUploadBook(model) || busy),
                  h.OnClick(SubmittedBookUpload({ groupRef })),
                  h.Title("Upload book"),
                ],
                [model.status === "uploading" ? "uploading…" : "upload"],
              ),
            ],
          ),
        ],
      ),
    ],
  );
};
