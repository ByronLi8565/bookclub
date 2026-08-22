import { Effect, Option, Queue, Schedule, Schema, Stream } from "effect";
import { Command, Subscription } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { m } from "foldkit/message";
import { HighlightAnchor, QuoteSelector } from "../../shared/types/notes.ts";
import {
  BOOKMARK_COLORS,
  BookmarkColor,
  StoredBookmark,
  type BookmarkColor as BookmarkColorType,
} from "../../shared/types/bookmarks.ts";
import { SourceReadingPosition } from "../../shared/types/readingPositions.ts";
import {
  contentTypeFor,
  extensionFor,
  SourceKind,
  type SourceSummary,
} from "../../shared/types/sources.ts";
import { PdfPageLayout, SmartArrows } from "../../shared/types/userPrefs.ts";
import { getCachedSource, putCachedSource } from "../logic/groups/sourceCache.ts";
import { bookclubClient } from "../logic/net/bookclubClient.ts";
import { getRenderSnapshot } from "../logic/reader/renderSnapshot.ts";
import { loadingView } from "./loading.ts";
import {
  browserReaderPositions,
  noReaderPositions,
  type ReaderPositions,
} from "./readerPositions.ts";
import {
  browserReaderBookmarks,
  noReaderBookmarks,
  type ReaderBookmarks,
} from "./readerBookmarks.ts";
import {
  ClearedEpubSelection,
  ClickedEpubHighlight,
  EpubPlace,
  cfiIsVisible,
  FailedEpubLoad,
  MovedEpub,
  OpenedEpub,
  SelectedEpubText,
  makeEpubMount,
  type EpubColors,
} from "./mounts/epub.ts";
import {
  PdfDocumentLoadFailed,
  PdfDocumentReady,
  PdfPositionChanged,
  PdfSelectionChanged,
  PdfSpreadRendered,
  browserPdfMountEnvironment,
  makePdfMount,
} from "./mounts/pdf.ts";

export const ReaderSearchMatch = Schema.Struct({ anchor: HighlightAnchor, excerpt: Schema.String });

/** A highlight the reader wants painted over the page. The quote is what lets
 *  a highlight be re-anchored after the text reflows. */
export const ReaderHighlight = Schema.Struct({ id: Schema.String, anchor: HighlightAnchor });
export type ReaderHighlight = typeof ReaderHighlight.Type;

export const ReaderPoint = Schema.Struct({ x: Schema.Number, y: Schema.Number });

/** A live text selection, with the viewport point its action popup hangs off. */
export const ReaderSelection = Schema.Struct({
  anchor: HighlightAnchor,
  quote: QuoteSelector,
  point: ReaderPoint,
});
export type ReaderSelection = typeof ReaderSelection.Type;

/** Chrome hides in two steps, matching the reader's keyboard and swipe
 *  contract: first the surrounding app chrome, then the reader's own toolbar. */
export const ChromeLevel = Schema.Literals([0, 1, 2]);
export type ChromeLevel = typeof ChromeLevel.Type;

export const ReaderPane = Schema.Literals(["reader", "notes"]);
export type ReaderPane = typeof ReaderPane.Type;

export const stepChrome = (level: ChromeLevel, direction: "hide" | "show"): ChromeLevel => {
  const next = level + (direction === "hide" ? 1 : -1);
  return next <= 0 ? 0 : next >= 2 ? 2 : 1;
};

/** A previously rendered page, kept so reopening a book shows something at
 *  once instead of an empty frame. */
export const ReaderSnapshotImage = Schema.Struct({
  dataUrl: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
});
export type ReaderSnapshotImage = typeof ReaderSnapshotImage.Type;

export const ReaderWorkspace = Schema.Struct({
  bookMenuOpen: Schema.Boolean,
  renamingBook: Schema.Boolean,
  bookTitleDraft: Schema.String,
  bookmarkMenuOpen: Schema.Boolean,
  bookmarkJumpMenuOpen: Schema.Boolean,
  groupRef: Schema.String,
  sourceId: Schema.String,
  kind: SourceKind,
  /** Who is reading, and in which club. Null until the application says: a
   *  reader with no identity keeps no place. */
  userId: Schema.NullOr(Schema.String),
  groupId: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  loading: Schema.Boolean,
  position: Schema.NullOr(SourceReadingPosition),
  bookmarks: Schema.Array(StoredBookmark),
  epubPlace: Schema.NullOr(EpubPlace),
  /** The measured page count, in the units the reader shows: EPUB presses or
   *  PDF pages. Zero total means "not measured yet". */
  page: Schema.Number,
  totalPages: Schema.Number,
  percentage: Schema.Number,
  atStart: Schema.Boolean,
  atEnd: Schema.Boolean,
  layout: PdfPageLayout,
  /** Once a spread needed a wider workspace, returning to one page keeps that
   *  room instead of making the notes jump back across the screen. */
  spreadPaneExpanded: Schema.Boolean,
  smartArrows: SmartArrows,
  /** EPUB text size and PDF zoom are the same control to the reader, but the
   *  renderers take them differently: an EPUB restyles in place, a PDF
   *  re-rasterizes through the live Mount. */
  fontSizePercent: Schema.Number,
  zoomPercent: Schema.Number,
  searchOpen: Schema.Boolean,
  searchQuery: Schema.String,
  searchMatches: Schema.Array(ReaderSearchMatch),
  activeSearchMatch: Schema.Number,
  highlights: Schema.Array(ReaderHighlight),
  activeHighlightId: Schema.NullOr(Schema.String),
  selection: Schema.NullOr(ReaderSelection),
  chromeLevel: ChromeLevel,
  pane: ReaderPane,
  snapshot: Schema.NullOr(ReaderSnapshotImage),
  /** Bumped when a restored reading position has to re-seed the Mount, which
   *  only a new element key can do. */
  /** A restored place the renderer has not been moved to yet. Held only while
   *  the book is still opening: a session that has not displayed anything
   *  cannot be told where to go. */
  pendingPlace: Schema.NullOr(SourceReadingPosition),
  error: Schema.NullOr(Schema.String),
});
export type ReaderWorkspace = typeof ReaderWorkspace.Type;

export const SelectedReaderSource = m("SelectedReaderSource", {
  groupRef: Schema.String,
  sourceId: Schema.String,
  kind: SourceKind,
});
export const ChangedReaderSearch = m("ChangedReaderSearch", { query: Schema.String });
export const OpenedReaderSearch = m("OpenedReaderSearch");
export const ClosedReaderSearch = m("ClosedReaderSearch");
export const RequestedReaderSearch = m("RequestedReaderSearch");
export const SearchedReader = m("SearchedReader", {
  query: Schema.String,
  matches: Schema.Array(ReaderSearchMatch),
});
export const SelectedSearchMatch = m("SelectedSearchMatch", { index: Schema.Number });
export const ChangedReaderLayout = m("ChangedReaderLayout", { layout: PdfPageLayout });
export const ToggledReaderLayout = m("ToggledReaderLayout");
export const ChangedReaderFontSize = m("ChangedReaderFontSize", { percent: Schema.Number });
export const SteppedReaderZoom = m("SteppedReaderZoom", {
  direction: Schema.Literals(["in", "out"]),
});
export const TurnedReaderPage = m("TurnedReaderPage", {
  direction: Schema.Literals(["next", "previous"]),
});
export const ShowedReaderHighlights = m("ShowedReaderHighlights", {
  highlights: Schema.Array(ReaderHighlight),
});
export const SteppedReaderChrome = m("SteppedReaderChrome", {
  direction: Schema.Literals(["hide", "show"]),
});
export const ToggledReaderChrome = m("ToggledReaderChrome");
export const SwitchedReaderPane = m("SwitchedReaderPane", { pane: ReaderPane });
export const MeasuredReaderPagination = m("MeasuredReaderPagination", {
  place: Schema.NullOr(EpubPlace),
});
export const IdentifiedReaderSession = m("IdentifiedReaderSession", {
  userId: Schema.String,
  groupId: Schema.String,
});
export const RestoredReaderPosition = m("RestoredReaderPosition", {
  sourceId: Schema.String,
  position: Schema.NullOr(SourceReadingPosition),
});
export const RequestedPositionSync = m("RequestedPositionSync");
export const PressedBookmarkButton = m("PressedBookmarkButton");
export const ChangedBookmarkColor = m("ChangedBookmarkColor", { color: BookmarkColor });
export const RemovedBookmark = m("RemovedBookmark");
export const ToggledBookmarkJumpMenu = m("ToggledBookmarkJumpMenu");
export const JumpedToBookmarkColor = m("JumpedToBookmarkColor", { color: BookmarkColor });
export const RestoredReaderBookmarks = m("RestoredReaderBookmarks", {
  sourceId: Schema.String,
  bookmarks: Schema.Array(StoredBookmark),
});
export const ShowedReaderSnapshot = m("ShowedReaderSnapshot", {
  sourceId: Schema.String,
  snapshot: Schema.NullOr(ReaderSnapshotImage),
});
export const CommittedReaderSelection = m("CommittedReaderSelection", {
  intent: Schema.Literals(["note", "highlight"]),
});
export const DismissedReaderSelection = m("DismissedReaderSelection");
export const RequestedFitToText = m("RequestedFitToText");
export const ToggledBookMenu = m("ToggledBookMenu");
export const ClosedBookMenu = m("ClosedBookMenu");
export const ClosedReaderMenus = m("ClosedReaderMenus");
export const StartedBookRename = m("StartedBookRename", { title: Schema.String });
export const ChangedBookTitleDraft = m("ChangedBookTitleDraft", { title: Schema.String });
export const CancelledBookRename = m("CancelledBookRename");
/** Show a passage the notes pane pointed at. */
/** A note's highlight names the book it lives in, because the note list shows
 *  every book's notes and the one being read is often not the one clicked. */
export const PendingJump = Schema.Struct({ sourceId: Schema.String, anchor: HighlightAnchor });
export type PendingJump = typeof PendingJump.Type;

export const JumpedToHighlight = m("JumpedToHighlight", PendingJump.fields);
export const SetReaderZoom = m("SetReaderZoom", { percent: Schema.Number });
export const CompletedReaderAction = m("CompletedReaderAction");

export const ReaderMessage = Schema.Union([
  SelectedReaderSource,
  ChangedReaderSearch,
  OpenedReaderSearch,
  ClosedReaderSearch,
  RequestedReaderSearch,
  SearchedReader,
  SelectedSearchMatch,
  ChangedReaderLayout,
  ToggledReaderLayout,
  ChangedReaderFontSize,
  SteppedReaderZoom,
  TurnedReaderPage,
  ShowedReaderHighlights,
  SteppedReaderChrome,
  ToggledReaderChrome,
  SwitchedReaderPane,
  MeasuredReaderPagination,
  IdentifiedReaderSession,
  RestoredReaderPosition,
  RequestedPositionSync,
  PressedBookmarkButton,
  ChangedBookmarkColor,
  RemovedBookmark,
  ToggledBookmarkJumpMenu,
  JumpedToBookmarkColor,
  RestoredReaderBookmarks,
  ShowedReaderSnapshot,
  CommittedReaderSelection,
  DismissedReaderSelection,
  RequestedFitToText,
  ToggledBookMenu,
  ClosedBookMenu,
  ClosedReaderMenus,
  StartedBookRename,
  ChangedBookTitleDraft,
  CancelledBookRename,
  JumpedToHighlight,
  SetReaderZoom,
  CompletedReaderAction,
  OpenedEpub,
  MovedEpub,
  SelectedEpubText,
  ClearedEpubSelection,
  ClickedEpubHighlight,
  FailedEpubLoad,
  PdfDocumentReady,
  PdfSpreadRendered,
  PdfDocumentLoadFailed,
  PdfSelectionChanged,
  PdfPositionChanged,
]);
export type ReaderMessage = typeof ReaderMessage.Type;

export const isReaderMessage = Schema.is(ReaderMessage);

/** The cache answers a reopened book without a round trip; the first open of a
 *  book downloads it and fills the cache for the next one. */
const loadBookBytes = async (sourceId: string, groupRef: string): Promise<ArrayBuffer> => {
  const cached = await getCachedSource(sourceId);
  if (cached !== null) return cached.arrayBuffer();

  const bytes = await Effect.runPromise(
    bookclubClient.pipe(
      Effect.flatMap((client) => client.groups.book({ params: { groupRef }, query: { sourceId } })),
      Effect.flatMap((stream) => Stream.runCollect(stream)),
    ),
  );
  // SAFETY: the response stream yields Uint8Array chunks backed by ArrayBuffer, not SharedArrayBuffer.
  const blob = new Blob([...bytes] as BlobPart[]);
  const kind = sniffSourceKind(await blob.slice(0, 4).arrayBuffer());
  const file = new File([blob], `${sourceId}.${extensionFor(kind)}`, {
    type: contentTypeFor(kind),
  });
  void putCachedSource(sourceId, file);
  return file.arrayBuffer();
};

const PDF_MAGIC = "%PDF";

/** The download carries no source kind, and an EPUB is a zip while a PDF says so
 *  in its first four bytes. */
const sniffSourceKind = (head: ArrayBuffer): SourceKind =>
  new TextDecoder().decode(head) === PDF_MAGIC ? "pdf" : "epub";

/** The reader's one environment dependency: how a source's bytes are found.
 *  Mount args are Schema-only, so this is closed over when the slice is
 *  constructed rather than passed through the Model. */
export interface ReaderEnvironment {
  loadSource: (sourceId: string, groupRef: string) => Promise<ArrayBuffer>;
  /** Where the reader's place is kept. A slice built without one opens every
   *  book at the beginning and records nothing. */
  positions?: ReaderPositions;
  bookmarks?: ReaderBookmarks;
  /** The last rendered page for a source, used as an opening placeholder. */
  snapshotFor?: (sourceId: string) => Promise<ReaderSnapshotImage | null>;
}

export const browserReaderEnvironment: ReaderEnvironment = {
  loadSource: loadBookBytes,
  positions: browserReaderPositions,
  bookmarks: browserReaderBookmarks,
  snapshotFor: async (sourceId) => {
    const snapshot = await getRenderSnapshot(sourceId);
    return snapshot === null
      ? null
      : { dataUrl: snapshot.dataUrl, width: snapshot.width, height: snapshot.height };
  },
};

/** What the reader bar needs from the club around it: which books there are,
 *  and what selecting, renaming or adding one means to the host. */
export interface ReaderViewContext<Message> {
  readonly books: readonly SourceSummary[];
  readonly title: string | null;
  readonly onSelectBook: (sourceId: string) => Message;
  readonly onRenameBook: ((sourceId: string, title: string) => Message) | null;
  readonly onAddBook: Message | null;
  /** Only an EPUB session needs this at mount time — its content lives in an
   *  iframe the app's `:root` custom properties can't reach. A later theme
   *  change is pushed in through `ApplyReaderColors` instead of a remount. */
  readonly colors: EpubColors;
}

/** React's `bookLabel`: a stored title, else the open book's parsed one, else
 *  the kind and a short id. */
const bookLabel = (book: SourceSummary, activeTitle: string | null, isActive: boolean): string =>
  book.title ??
  (isActive && activeTitle !== null
    ? activeTitle
    : `${book.kind.toUpperCase()} · ${book.id.slice(0, 8)}`);

const bookTitleView = <Message>(
  reader: ReaderWorkspace,
  context: ReaderViewContext<Message>,
  label: string,
  h: HtmlBuilder<Message | ReaderMessage>,
): Html => {
  const rename = context.onRenameBook;
  if (rename === null || label === "") return h.span([h.Class("reader-title")], [label]);
  return reader.renamingBook
    ? h.input([
        h.Class("reader-title-edit"),
        h.Autofocus(true),
        h.AriaLabel("book title"),
        h.Value(reader.bookTitleDraft),
        h.OnInput((title) => ChangedBookTitleDraft({ title })),
        h.OnBlur(
          reader.bookTitleDraft.trim() === "" || reader.bookTitleDraft === label
            ? CancelledBookRename()
            : rename(reader.sourceId, reader.bookTitleDraft.trim()),
        ),
        h.OnKeyDownPreventDefault((key) =>
          key === "Enter"
            ? Option.some(
                reader.bookTitleDraft.trim() === "" || reader.bookTitleDraft === label
                  ? CancelledBookRename()
                  : rename(reader.sourceId, reader.bookTitleDraft.trim()),
              )
            : key === "Escape"
              ? Option.some(CancelledBookRename())
              : Option.none(),
        ),
      ])
    : h.span(
        [
          h.Class("reader-title"),
          h.Title("Double-click to rename the book"),
          h.OnDoubleClick(StartedBookRename({ title: label })),
        ],
        [label],
      );
};

/** React's `BookMenu`: the open book's title, and — when there is more than one
 *  book or a way to add one — a dropdown to switch between them. */
const bookMenu = <Message>(
  reader: ReaderWorkspace,
  context: ReaderViewContext<Message>,
  h: HtmlBuilder<Message | ReaderMessage>,
): Html => {
  const active = context.books.find((book) => book.id === reader.sourceId) ?? null;
  const label = active === null ? (context.title ?? "") : bookLabel(active, context.title, true);
  const title = bookTitleView(reader, context, label, h);
  if (context.books.length <= 1 && context.onAddBook === null) return title;
  return h.div(
    [h.Class("book-menu")],
    [
      title,
      h.button(
        [
          h.Type("button"),
          h.Class("book-menu-arrow"),
          h.AriaHasPopup("menu"),
          h.AriaExpanded(reader.bookMenuOpen),
          h.AriaLabel("switch book"),
          h.Title("Switch book"),
          h.OnClick(ToggledBookMenu()),
        ],
        ["\u25BE"],
      ),
      ...(reader.bookMenuOpen
        ? [
            h.ul(
              [h.Class("book-menu-list"), h.Role("menu")],
              [
                ...context.books.map((book) => {
                  const name = bookLabel(book, context.title, book.id === reader.sourceId);
                  return h.li(
                    [h.Key(book.id), h.Role("none")],
                    [
                      h.button(
                        [
                          h.Type("button"),
                          h.Role("menuitemradio"),
                          h.AriaChecked(book.id === reader.sourceId),
                          h.Class(
                            book.id === reader.sourceId
                              ? "book-menu-item is-active"
                              : "book-menu-item",
                          ),
                          h.Title(`Open ${name}`),
                          h.OnClick(context.onSelectBook(book.id)),
                        ],
                        [name],
                      ),
                    ],
                  );
                }),
                ...(context.onAddBook === null
                  ? []
                  : [
                      h.li(
                        [h.Key("add-book"), h.Role("none"), h.Class("book-menu-add")],
                        [
                          h.button(
                            [
                              h.Type("button"),
                              h.Role("menuitem"),
                              h.Class("book-menu-item"),
                              h.Title("Add a book"),
                              h.OnClick(context.onAddBook),
                            ],
                            ["+ Add a book"],
                          ),
                        ],
                      ),
                    ]),
              ],
            ),
          ]
        : []),
    ],
  );
};

const pageCount = <Message>(
  reader: ReaderWorkspace,
  h: HtmlBuilder<Message | ReaderMessage>,
): Html[] =>
  reader.totalPages === 0
    ? []
    : [
        h.span(
          [h.Class("page-count"), h.Role("status")],
          [
            `${reader.page} / ${reader.totalPages}`,
            reader.percentage > 0 ? ` · ${Math.round(reader.percentage * 100)}%` : "",
          ],
        ),
      ];

const FIT_TO_TEXT_PATH = "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5";

const readerZoom = <Message>(
  reader: ReaderWorkspace,
  h: HtmlBuilder<Message | ReaderMessage>,
  { percent, fitToText }: { percent: number; fitToText: boolean },
): Html[] => {
  return [
    ...(fitToText
      ? [
          h.button(
            [
              h.Type("button"),
              h.Class("reader-fit"),
              h.Disabled(reader.loading),
              h.AriaLabel("Fit text to screen"),
              h.Title("Fit text to screen"),
              h.OnClick(RequestedFitToText()),
            ],
            [
              h.svg(
                [h.ViewBox("0 0 24 24"), h.AriaHidden(true)],
                [
                  h.path([
                    h.D(FIT_TO_TEXT_PATH),
                    h.Fill("none"),
                    h.Stroke("currentColor"),
                    h.StrokeWidth("2.5"),
                    h.StrokeLinecap("square"),
                    h.StrokeLinejoin("miter"),
                  ]),
                ],
              ),
            ],
          ),
        ]
      : []),
    h.button(
      [
        h.Type("button"),
        h.Disabled(reader.loading),
        h.Title("Decrease text size"),
        h.OnClick(SteppedReaderZoom({ direction: "out" })),
      ],
      ["\u2212"],
    ),
    h.span([h.Class("font-size")], [`${percent}%`]),
    h.button(
      [
        h.Type("button"),
        h.Disabled(reader.loading),
        h.Title("Increase text size"),
        h.OnClick(SteppedReaderZoom({ direction: "in" })),
      ],
      ["+"],
    ),
  ];
};

export const openReader = (input: typeof SelectedReaderSource.Type): ReaderWorkspace => ({
  bookMenuOpen: false,
  renamingBook: false,
  bookTitleDraft: "",
  bookmarkMenuOpen: false,
  bookmarkJumpMenuOpen: false,
  groupRef: input.groupRef,
  sourceId: input.sourceId,
  kind: input.kind,
  userId: null,
  groupId: null,
  title: null,
  loading: true,
  position: null,
  bookmarks: [],
  epubPlace: null,
  page: 0,
  totalPages: 0,
  percentage: 0,
  atStart: true,
  atEnd: false,
  layout: "single",
  spreadPaneExpanded: false,
  smartArrows: "instant",
  fontSizePercent: 100,
  zoomPercent: 100,
  searchOpen: false,
  searchQuery: "",
  searchMatches: [],
  activeSearchMatch: 0,
  highlights: [],
  activeHighlightId: null,
  selection: null,
  chromeLevel: 0,
  pane: "reader",
  snapshot: null,
  pendingPlace: null,
  error: null,
});

export type ReaderUpdate = readonly [
  ReaderWorkspace,
  readonly Command.Command<ReaderMessage, never, never>[],
];

/** The shared reader talks only to this renderer contract. EPUB and PDF keep
 *  their imperative library handles inside their own Mounts; the backend
 *  translates shared reader intentions into those renderer-specific actions. */
export interface ReaderBackend<Mount> {
  search(query: string): Effect.Effect<readonly (typeof ReaderSearchMatch.Type)[], never>;
  turnPage(
    direction: "next" | "previous",
    zoomPercent: number,
  ): Effect.Effect<void | undefined, unknown>;
  goTo(anchor: HighlightAnchor): Effect.Effect<void | undefined, unknown>;
  setSearchHighlight(anchor: HighlightAnchor | null): Effect.Effect<void, never>;
  syncHighlights(highlights: readonly ReaderHighlight[]): Effect.Effect<void, never>;
  dismissSelection: Effect.Effect<void, never>;
  changeLayout(reader: ReaderWorkspace, layout: PdfPageLayout): ReaderUpdate;
  changeFontSize(reader: ReaderWorkspace, percent: number): ReaderUpdate | null;
  stepZoom(reader: ReaderWorkspace, percent: number): ReaderUpdate;
  fitToText(reader: ReaderWorkspace): ReaderUpdate | null;
  zoom(reader: ReaderWorkspace): { percent: number; fitToText: boolean };
  mountKey(reader: ReaderWorkspace): string;
  mount<Message>(reader: ReaderWorkspace, context: ReaderViewContext<Message>): Mount;
}

const PANE_SWIPE_DELTA_PX = 50;
const CHROME_SWIPE_DELTA_PX = 80;
const SWIPE_DURATION_MS = 500;

/** A swipe that starts inside something the user can pan sideways belongs to
 *  that scroller, not to the workspace. */
function startedOnHorizontalScroller(target: EventTarget | null): boolean {
  let element = target instanceof Element ? target : null;
  while (element) {
    if (element.scrollWidth - element.clientWidth > 1) {
      const overflowX = getComputedStyle(element).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
    element = element.parentElement;
  }
  return false;
}

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** The reader's keyboard contract, previously owned by @tanstack/react-hotkeys.
 *  Returns the Message a key press means, or none when the reader does not
 *  claim that press. */
export const readerKeyMessage = (
  event: KeyboardEvent,
  searchOpen: boolean,
): Option.Option<ReaderMessage> => {
  if (event.defaultPrevented) return Option.none();
  const claim = <A>(message: A): Option.Option<A> => {
    event.preventDefault();
    return Option.some(message);
  };
  if (event.key === "Escape" && searchOpen) return Option.some(ClosedReaderSearch());
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
    return claim(OpenedReaderSearch());
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    return claim(RequestedPositionSync());
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return Option.none();
  if (isTypingTarget(event.target)) return Option.none();
  if (event.shiftKey) {
    if (event.key === "ArrowUp") return claim(SteppedReaderChrome({ direction: "hide" }));
    if (event.key === "ArrowDown") return claim(SteppedReaderChrome({ direction: "show" }));
    return Option.none();
  }
  switch (event.key) {
    case "ArrowRight":
      return claim(TurnedReaderPage({ direction: "next" }));
    case "ArrowLeft":
      return claim(TurnedReaderPage({ direction: "previous" }));
    case "d":
      return claim(ToggledReaderLayout());
    case "f":
      return claim(RequestedFitToText());
    case "s":
      return claim(ToggledBookMenu());
    case "z":
      return claim(ToggledReaderChrome());
    default:
      return Option.none();
  }
};

interface SwipeStart {
  x: number;
  y: number;
  at: number;
  locked: boolean;
}

/** The reader's touch contract, previously owned by react-swipeable: the same
 *  per-direction thresholds, the same swipe window, and the same deference to
 *  a horizontal scroller under the finger. */
export const readerSwipeStream = (pane: ReaderPane): Stream.Stream<ReaderMessage> =>
  Stream.callback<ReaderMessage>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        let start: SwipeStart | null = null;
        const onStart = (event: TouchEvent) => {
          const touch = event.touches[0];
          start =
            touch === undefined || event.touches.length > 1
              ? null
              : {
                  x: touch.clientX,
                  y: touch.clientY,
                  at: event.timeStamp,
                  locked: startedOnHorizontalScroller(event.target),
                };
        };
        const onEnd = (event: TouchEvent) => {
          const began = start;
          start = null;
          const touch = event.changedTouches[0];
          if (began === null || touch === undefined) return;
          if (event.timeStamp - began.at > SWIPE_DURATION_MS) return;
          const deltaX = touch.clientX - began.x;
          const deltaY = touch.clientY - began.y;
          const horizontal = Math.abs(deltaX) >= Math.abs(deltaY);
          if (horizontal) {
            if (began.locked || Math.abs(deltaX) < PANE_SWIPE_DELTA_PX) return;
            Queue.offerUnsafe(queue, SwitchedReaderPane({ pane: deltaX < 0 ? "notes" : "reader" }));
            return;
          }
          if (pane !== "reader" || Math.abs(deltaY) < CHROME_SWIPE_DELTA_PX) return;
          Queue.offerUnsafe(
            queue,
            SteppedReaderChrome({ direction: deltaY < 0 ? "hide" : "show" }),
          );
        };
        document.addEventListener("touchstart", onStart, { passive: true });
        document.addEventListener("touchend", onEnd, { passive: true });
        return () => {
          document.removeEventListener("touchstart", onStart);
          document.removeEventListener("touchend", onEnd);
        };
      }),
      (remove) => Effect.sync(remove),
    ).pipe(Effect.andThen(Effect.never)),
  );

/**
 * The reader's browser-event Subscriptions. Both are gated on a reader being
 * open, so closing the reader removes the listeners with the Subscription's
 * scope rather than leaving them to filter events for a reader that is gone.
 */
export const makeReaderSubscriptions = <Model, Message>({
  modelToReader,
  toMessage,
}: {
  modelToReader: (model: Model) => ReaderWorkspace | null;
  toMessage: (message: ReaderMessage) => Message;
}) =>
  Subscription.make<Model, Message>()((entry) => ({
    readerKeyboard: entry(
      { open: Schema.Boolean, searchOpen: Schema.Boolean },
      {
        modelToDependencies: (model) => {
          const reader = modelToReader(model);
          return { open: reader !== null, searchOpen: reader?.searchOpen ?? false };
        },
        dependenciesToStream: ({ open, searchOpen }) =>
          Stream.when(
            Subscription.fromEventFilterMap<KeyboardEvent, Message>({
              target: globalThis.document,
              type: "keydown",
              toMessage: (event) =>
                Option.map(readerKeyMessage(event, searchOpen), (message) => toMessage(message)),
            }),
            Effect.sync(() => open),
          ),
      },
    ),
    readerMenuDismissal: entry(
      { open: Schema.Boolean },
      {
        modelToDependencies: (model) => {
          const reader = modelToReader(model);
          return {
            open:
              reader?.bookMenuOpen === true ||
              reader?.bookmarkMenuOpen === true ||
              reader?.bookmarkJumpMenuOpen === true,
          };
        },
        dependenciesToStream: ({ open }) =>
          Stream.when(
            Subscription.fromEventFilterMap<PointerEvent, Message>({
              target: globalThis.document,
              type: "pointerdown",
              toMessage: (event) =>
                event.target instanceof Element &&
                event.target.closest(".book-menu, .reader-bookmarks") !== null
                  ? Option.none()
                  : Option.some(toMessage(ClosedReaderMenus())),
            }),
            Effect.sync(() => open),
          ),
      },
    ),
    readerSelectionDismissal: entry(
      { selecting: Schema.Boolean },
      {
        modelToDependencies: (model) => ({ selecting: modelToReader(model)?.selection !== null }),
        dependenciesToStream: ({ selecting }) =>
          Stream.when(
            Subscription.fromEventFilterMap<PointerEvent, Message>({
              target: globalThis.document,
              type: "pointerdown",
              // A press inside the popup is the popup's own business; anywhere
              // else lets the selection go, the way the React reader does.
              toMessage: (event) =>
                event.target instanceof Element && event.target.closest(".selection-actions")
                  ? Option.none()
                  : Option.some(toMessage(DismissedReaderSelection())),
            }),
            Effect.sync(() => selecting),
          ),
      },
    ),
    readerPositionSync: entry(
      { syncing: Schema.Boolean },
      {
        modelToDependencies: (model) => {
          const reader = modelToReader(model);
          return { syncing: reader !== null && reader.userId !== null && reader.groupId !== null };
        },
        // The place is written locally on every move; this is the slower beat
        // that pushes whatever the server has not seen.
        dependenciesToStream: ({ syncing }) =>
          Stream.when(
            Stream.map(Stream.fromSchedule(Schedule.spaced("3 seconds")), () =>
              toMessage(RequestedPositionSync()),
            ),
            Effect.sync(() => syncing),
          ),
      },
    ),
    readerSwipe: entry(
      { open: Schema.Boolean, pane: ReaderPane },
      {
        modelToDependencies: (model) => {
          const reader = modelToReader(model);
          return { open: reader !== null, pane: reader?.pane ?? "reader" };
        },
        dependenciesToStream: ({ open, pane }) =>
          Stream.when(
            Stream.map(readerSwipeStream(pane), toMessage),
            Effect.sync(() => open),
          ),
      },
    ),
  }));

/**
 * The reader slice: the Mounts that own epub.js and PDF.js, the Commands that
 * act on whichever document is live, and the update and view built over them.
 * One slice per running application — the Mounts hold the live handles.
 */
export const makeReaderSlice = ({
  loadSource,
  positions = noReaderPositions,
  bookmarks = noReaderBookmarks,
  snapshotFor = () => Promise.resolve(null),
}: ReaderEnvironment) => {
  const epubReaderMount = makeEpubMount({ loadSource });
  const pdfReaderMount = makePdfMount(browserPdfMountEnvironment(loadSource));
  const PdfReaderMount = pdfReaderMount.Mount;

  const epubSpread = (layout: PdfPageLayout) => (layout === "auto" ? "auto" : "none");

  type ReaderMount = ReturnType<typeof epubReaderMount.Mount> | ReturnType<typeof PdfReaderMount>;

  const readerBackends = {
    epub: {
      search: (query) => epubReaderMount.reader.search(query),
      turnPage: (direction) => epubReaderMount.turnPage(direction),
      goTo: (anchor) => epubReaderMount.goTo(anchor),
      setSearchHighlight: (anchor) => epubReaderMount.setSearchHighlight(anchor),
      syncHighlights: (highlights) =>
        epubReaderMount.syncHighlights(
          highlights.flatMap((highlight) =>
            highlight.anchor.kind === "epub-cfi"
              ? [{ id: highlight.id, cfi: highlight.anchor.value }]
              : [],
          ),
        ),
      dismissSelection: epubReaderMount.dismissSelection,
      changeLayout: (reader, layout) => [
        { ...reader, layout, spreadPaneExpanded: reader.spreadPaneExpanded || layout === "auto" },
        [SetEpubSpread({ layout })],
      ],
      changeFontSize: (reader, percent) => [
        { ...reader, fontSizePercent: percent },
        [SetEpubFontSize({ percent }), MeasureEpubPagination({})],
      ],
      stepZoom: (reader, percent) => [
        { ...reader, fontSizePercent: percent },
        [SetEpubFontSize({ percent }), MeasureEpubPagination({})],
      ],
      fitToText: () => null,
      zoom: (reader) => ({ percent: reader.fontSizePercent, fitToText: false }),
      mountKey: (reader) => `epub:${reader.sourceId}`,
      mount: (reader, context) =>
        epubReaderMount.Mount({
          sourceId: reader.sourceId,
          groupRef: reader.groupRef,
          initialCfi: reader.position?.kind === "epub" ? reader.position.cfi : null,
          spread: epubSpread(reader.layout),
          fontSizePercent: reader.fontSizePercent,
          colors: context.colors,
        }),
    },
    pdf: {
      search: (query) => pdfReaderMount.search(query),
      turnPage: (direction, zoomPercent) => pdfReaderMount.turnPage(direction, zoomPercent),
      goTo: (anchor) => pdfReaderMount.goTo(anchor),
      setSearchHighlight: (anchor) => pdfReaderMount.setSearchHighlight(anchor),
      syncHighlights: (highlights) => pdfReaderMount.syncHighlights(highlights),
      dismissSelection: pdfReaderMount.dismissSelection,
      changeLayout: (reader, layout) => [
        { ...reader, layout, spreadPaneExpanded: reader.spreadPaneExpanded || layout === "auto" },
        [],
      ],
      changeFontSize: () => null,
      stepZoom: (reader, percent) => [
        { ...reader, zoomPercent: percent },
        [ApplyPdfZoom({ percent })],
      ],
      fitToText: (reader) => [reader, [FitPdfToText({})]],
      zoom: (reader) => ({ percent: reader.zoomPercent, fitToText: true }),
      mountKey: (reader) => `pdf:${reader.sourceId}:${reader.layout}:${reader.smartArrows}`,
      mount: (reader, context) =>
        PdfReaderMount({
          sourceId: reader.sourceId,
          groupRef: reader.groupRef,
          initialPage: reader.position?.kind === "pdf" ? reader.position.page : reader.page || 1,
          zoom: reader.zoomPercent,
          layout: reader.layout,
          colors: { background: context.colors.background, text: context.colors.text },
          smartArrows: reader.smartArrows,
        }),
    },
  } satisfies Record<SourceKind, ReaderBackend<ReaderMount>>;

  const backendFor = (kind: SourceKind): ReaderBackend<ReaderMount> => readerBackends[kind];

  const logCommandFailure = (error: unknown) =>
    Effect.sync(() => console.error("Reader command failed", error)).pipe(
      Effect.as(CompletedReaderAction()),
    );

  const SearchReader = Command.define("SearchReader", {
    args: { query: Schema.String, kind: SourceKind },
    messages: [SearchedReader, CompletedReaderAction],
    execute: ({ query, kind }) =>
      backendFor(kind)
        .search(query)
        .pipe(
          Effect.map((matches) => SearchedReader({ query, matches })),
          Effect.catch(logCommandFailure),
        ),
  });

  const TurnReaderPage = Command.define("TurnReaderPage", {
    args: {
      direction: Schema.Literals(["next", "previous"]),
      kind: SourceKind,
      zoomPercent: Schema.Number,
    },
    messages: [CompletedReaderAction],
    execute: ({ direction, kind, zoomPercent }) =>
      backendFor(kind)
        .turnPage(direction, zoomPercent)
        .pipe(Effect.as(CompletedReaderAction()), Effect.catch(logCommandFailure)),
  });

  const GoToSearchMatch = Command.define("GoToSearchMatch", {
    args: { anchor: HighlightAnchor, kind: SourceKind },
    messages: [CompletedReaderAction],
    execute: ({ anchor, kind }) =>
      backendFor(kind)
        .goTo(anchor)
        .pipe(
          Effect.andThen(backendFor(kind).setSearchHighlight(anchor)),
          Effect.as(CompletedReaderAction()),
          Effect.catch(logCommandFailure),
        ),
  });

  const GoToReaderAnchor = Command.define("GoToReaderAnchor", {
    args: { anchor: HighlightAnchor, kind: SourceKind },
    messages: [CompletedReaderAction],
    execute: ({ anchor, kind }) =>
      backendFor(kind)
        .goTo(anchor)
        .pipe(Effect.as(CompletedReaderAction()), Effect.catch(logCommandFailure)),
  });

  const ClearSearchHighlight = Command.define("ClearSearchHighlight", {
    args: { kind: SourceKind },
    messages: [CompletedReaderAction],
    execute: ({ kind }) =>
      backendFor(kind).setSearchHighlight(null).pipe(Effect.as(CompletedReaderAction())),
  });

  const PaintReaderHighlights = Command.define("PaintReaderHighlights", {
    args: { highlights: Schema.Array(ReaderHighlight), kind: SourceKind },
    messages: [CompletedReaderAction],
    execute: ({ highlights, kind }) =>
      backendFor(kind).syncHighlights(highlights).pipe(Effect.as(CompletedReaderAction())),
  });

  const RestoreReaderPosition = Command.define("RestoreReaderPosition", {
    args: {
      userId: Schema.String,
      groupId: Schema.String,
      sourceId: Schema.String,
      kind: SourceKind,
    },
    messages: [RestoredReaderPosition],
    execute: (input) =>
      positions
        .restore(input)
        .pipe(
          Effect.map((position) => RestoredReaderPosition({ sourceId: input.sourceId, position })),
        ),
  });

  const RecordReaderPosition = Command.define("RecordReaderPosition", {
    args: {
      userId: Schema.String,
      groupId: Schema.String,
      sourceId: Schema.String,
      position: SourceReadingPosition,
    },
    messages: [CompletedReaderAction],
    execute: (input) => positions.record(input).pipe(Effect.as(CompletedReaderAction())),
  });

  const SyncReaderPosition = Command.define("SyncReaderPosition", {
    args: { userId: Schema.String, groupId: Schema.String, sourceId: Schema.String },
    messages: [CompletedReaderAction],
    execute: (input) => positions.sync(input).pipe(Effect.as(CompletedReaderAction())),
  });

  const RestoreReaderBookmarks = Command.define("RestoreReaderBookmarks", {
    args: { userId: Schema.String, groupId: Schema.String, sourceId: Schema.String },
    messages: [RestoredReaderBookmarks],
    execute: (input) =>
      bookmarks
        .restore(input)
        .pipe(
          Effect.map((stored) =>
            RestoredReaderBookmarks({ sourceId: input.sourceId, bookmarks: stored }),
          ),
        ),
  });

  const SaveReaderBookmark = Command.define("SaveReaderBookmark", {
    args: {
      userId: Schema.String,
      groupId: Schema.String,
      sourceId: Schema.String,
      position: SourceReadingPosition,
      oldColor: Schema.NullOr(BookmarkColor),
      newColor: Schema.NullOr(BookmarkColor),
    },
    messages: [RestoredReaderBookmarks],
    execute: (input) => {
      const remove =
        input.oldColor === null
          ? Effect.succeed([])
          : bookmarks.set({ ...input, color: input.oldColor, deleted: true });
      return remove.pipe(
        Effect.flatMap(() =>
          input.newColor === null
            ? bookmarks.restore(input)
            : bookmarks.set({ ...input, color: input.newColor, deleted: false }),
        ),
        Effect.map((stored) =>
          RestoredReaderBookmarks({ sourceId: input.sourceId, bookmarks: stored }),
        ),
      );
    },
  });

  const SyncReaderBookmarks = Command.define("SyncReaderBookmarks", {
    args: { userId: Schema.String, groupId: Schema.String, sourceId: Schema.String },
    messages: [RestoredReaderBookmarks],
    execute: (input) =>
      bookmarks
        .sync(input)
        .pipe(
          Effect.map((stored) =>
            RestoredReaderBookmarks({ sourceId: input.sourceId, bookmarks: stored }),
          ),
        ),
  });

  const LoadReaderSnapshot = Command.define("LoadReaderSnapshot", {
    args: { sourceId: Schema.String },
    messages: [ShowedReaderSnapshot],
    execute: ({ sourceId }) =>
      Effect.promise(async () => {
        // IndexedDB is only a paint optimization. Safari can leave an open
        // request pending, so storage never gets to hold the real reader shut.
        const snapshot = await Promise.race([
          snapshotFor(sourceId),
          new Promise<null>((resolve) => {
            setTimeout(() => {
              resolve(null);
            }, 100);
          }),
        ]);
        return ShowedReaderSnapshot({ sourceId, snapshot });
      }),
  });

  const FitPdfToText = Command.define("FitPdfToText", {
    args: {},
    messages: [CompletedReaderAction],
    // PdfSpreadRendered publishes the fitted zoom with the completed render.
    // Feeding it back through ApplyPdfZoom would misclassify the fit itself as
    // a manual zoom and immediately turn persistent fit mode back off.
    execute: () => pdfReaderMount.fitToText.pipe(Effect.as(CompletedReaderAction())),
  });

  const ApplyPdfZoom = Command.define("ApplyPdfZoom", {
    args: { percent: Schema.Number },
    messages: [CompletedReaderAction],
    execute: ({ percent }) =>
      pdfReaderMount.setZoom(percent).pipe(Effect.as(CompletedReaderAction())),
  });

  const DismissReaderSelection = Command.define("DismissReaderSelection", {
    args: { kind: SourceKind },
    messages: [CompletedReaderAction],
    execute: ({ kind }) =>
      backendFor(kind).dismissSelection.pipe(Effect.as(CompletedReaderAction())),
  });

  const SetEpubFontSize = Command.define("SetEpubFontSize", {
    args: { percent: Schema.Number },
    messages: [CompletedReaderAction],
    execute: ({ percent }) =>
      epubReaderMount.setFontSize(percent).pipe(Effect.as(CompletedReaderAction())),
  });

  /** An EPUB relayouts in place rather than remounting, so the reader keeps its
   *  place and its painted annotations across a spread change. */
  const SetEpubSpread = Command.define("SetEpubSpread", {
    args: { layout: PdfPageLayout },
    messages: [MeasuredReaderPagination, CompletedReaderAction],
    execute: ({ layout }) =>
      epubReaderMount.setSpread(epubSpread(layout)).pipe(
        Effect.andThen(epubReaderMount.measurePagination),
        Effect.map((place) => MeasuredReaderPagination({ place })),
        Effect.catch(logCommandFailure),
      ),
  });

  const MeasureEpubPagination = Command.define("MeasureEpubPagination", {
    args: {},
    messages: [MeasuredReaderPagination, CompletedReaderAction],
    execute: () =>
      epubReaderMount.measurePagination.pipe(
        Effect.map((place) => MeasuredReaderPagination({ place })),
        Effect.catch(logCommandFailure),
      ),
  });

  const placed = (reader: ReaderWorkspace, place: EpubPlace): ReaderWorkspace => ({
    ...reader,
    epubPlace: place,
    page: place.count.page,
    totalPages: place.count.total,
    percentage: place.count.percentage,
    atStart: place.atStart,
    atEnd: place.atEnd,
    position:
      place.cfi === null
        ? reader.position
        : { kind: "epub", cfi: place.cfi, percentage: place.count.percentage },
  });

  /** The renderer navigates by anchor, and a stored place is one in all but
   *  name: a CFI for an epub, a page for a PDF. */
  const goToPlace = (reader: ReaderWorkspace, place: SourceReadingPosition | null) => {
    if (place === null) return [];
    const anchor: HighlightAnchor =
      place.kind === "epub"
        ? { kind: "epub-cfi", value: place.cfi }
        : { kind: "pdf-text", page: place.page, rects: [] };
    return [GoToReaderAnchor({ anchor, kind: reader.kind })];
  };

  const liveBookmarks = (reader: ReaderWorkspace) =>
    reader.bookmarks.filter((bookmark) => bookmark.deletedAt === null);

  const bookmarkAtCurrentPlace = (reader: ReaderWorkspace) => {
    return (
      liveBookmarks(reader).find((bookmark) => {
        const saved = bookmark.position;
        const current = reader.position;
        // The rendered page arrives before the position recorder on PDFs. Use
        // what is visibly on screen so the edit control does not briefly (or,
        // after a cancelled recorder, permanently) describe the previous page.
        if (saved.kind === "pdf" && reader.kind === "pdf") return saved.page === reader.page;
        if (saved.kind !== "epub" || current?.kind !== "epub") return false;
        if (saved.cfi === current.cfi) return true;
        const visible = reader.epubPlace;
        return visible?.cfi !== null && visible?.endCfi !== undefined
          ? cfiIsVisible(saved.cfi, visible.cfi, visible.endCfi)
          : false;
      }) ?? null
    );
  };

  const saveBookmark = (
    reader: ReaderWorkspace,
    oldColor: BookmarkColorType | null,
    newColor: BookmarkColorType | null,
  ) =>
    reader.userId === null || reader.groupId === null || reader.position === null
      ? []
      : [
          SaveReaderBookmark({
            userId: reader.userId,
            groupId: reader.groupId,
            sourceId: reader.sourceId,
            position: reader.position,
            oldColor,
            newColor,
          }),
        ];

  /** Recording is local and cheap, so every reported place is written; the
   *  server only hears about it on the sync tick. */
  const recordPosition = (reader: ReaderWorkspace) =>
    reader.userId === null || reader.groupId === null || reader.position === null
      ? []
      : [
          RecordReaderPosition({
            userId: reader.userId,
            groupId: reader.groupId,
            sourceId: reader.sourceId,
            position: reader.position,
          }),
        ];

  const updateReader = (reader: ReaderWorkspace, message: ReaderMessage): ReaderUpdate | null => {
    switch (message._tag) {
      case "SelectedReaderSource":
        return [openReader(message), [LoadReaderSnapshot({ sourceId: message.sourceId })]];
      case "ChangedReaderSearch":
        return [{ ...reader, searchQuery: message.query }, []];
      case "OpenedReaderSearch":
        return [{ ...reader, searchOpen: true }, []];
      case "ClosedReaderSearch":
        return [
          { ...reader, searchOpen: false, searchMatches: [], activeSearchMatch: 0 },
          [ClearSearchHighlight({ kind: reader.kind })],
        ];
      case "RequestedReaderSearch":
        return [reader, [SearchReader({ query: reader.searchQuery, kind: reader.kind })]];
      case "SearchedReader":
        return reader.searchQuery === message.query
          ? [{ ...reader, searchMatches: message.matches, activeSearchMatch: 0 }, []]
          : [reader, []];
      case "SelectedSearchMatch": {
        if (reader.searchMatches.length === 0) return [reader, []];
        const activeSearchMatch =
          ((message.index % reader.searchMatches.length) + reader.searchMatches.length) %
          reader.searchMatches.length;
        const match = reader.searchMatches[activeSearchMatch];
        return match === undefined
          ? [reader, []]
          : [
              { ...reader, activeSearchMatch },
              [GoToSearchMatch({ anchor: match.anchor, kind: reader.kind })],
            ];
      }
      case "ToggledReaderLayout":
        return updateReader(
          reader,
          ChangedReaderLayout({ layout: reader.layout === "auto" ? "single" : "auto" }),
        );
      case "ChangedReaderLayout":
        return message.layout === reader.layout
          ? [reader, []]
          : backendFor(reader.kind).changeLayout(reader, message.layout);
      case "ChangedReaderFontSize":
        return backendFor(reader.kind).changeFontSize(reader, message.percent);
      case "SteppedReaderZoom": {
        const step = message.direction === "in" ? 25 : -25;
        const next = Math.min(
          400,
          Math.max(50, backendFor(reader.kind).zoom(reader).percent + step),
        );
        return backendFor(reader.kind).stepZoom(reader, next);
      }
      case "TurnedReaderPage":
        return [
          reader,
          [
            TurnReaderPage({
              direction: message.direction,
              kind: reader.kind,
              zoomPercent: reader.zoomPercent,
            }),
          ],
        ];
      case "ShowedReaderHighlights":
        return [
          { ...reader, highlights: message.highlights },
          [PaintReaderHighlights({ highlights: message.highlights, kind: reader.kind })],
        ];
      case "SteppedReaderChrome":
        return [{ ...reader, chromeLevel: stepChrome(reader.chromeLevel, message.direction) }, []];
      case "ToggledReaderChrome":
        return [{ ...reader, chromeLevel: reader.chromeLevel === 0 ? 2 : 0 }, []];
      case "SwitchedReaderPane":
        return [{ ...reader, pane: message.pane }, []];
      case "IdentifiedReaderSession":
        return [
          { ...reader, userId: message.userId, groupId: message.groupId },
          [
            RestoreReaderPosition({
              userId: message.userId,
              groupId: message.groupId,
              sourceId: reader.sourceId,
              kind: reader.kind,
            }),
            RestoreReaderBookmarks({
              userId: message.userId,
              groupId: message.groupId,
              sourceId: reader.sourceId,
            }),
          ],
        ];
      case "RestoredReaderPosition": {
        if (message.sourceId !== reader.sourceId || message.position === null) return [reader, []];
        const restored = { ...reader, position: message.position };
        // Moving the open book, rather than rebuilding the session around a new
        // element key. A rebuild downloads and opens the book a second time, and
        // destroys the first session while it is still opening — which is the
        // blank page a reader gets when reopening a book they have read before.
        return reader.loading
          ? [{ ...restored, pendingPlace: message.position }, []]
          : [restored, goToPlace(reader, message.position)];
      }
      case "RequestedPositionSync":
        return reader.userId === null || reader.groupId === null
          ? [reader, []]
          : [
              reader,
              [
                SyncReaderPosition({
                  userId: reader.userId,
                  groupId: reader.groupId,
                  sourceId: reader.sourceId,
                }),
                SyncReaderBookmarks({
                  userId: reader.userId,
                  groupId: reader.groupId,
                  sourceId: reader.sourceId,
                }),
              ],
            ];
      case "RestoredReaderBookmarks":
        return message.sourceId === reader.sourceId
          ? [{ ...reader, bookmarks: message.bookmarks }, []]
          : [reader, []];
      case "PressedBookmarkButton": {
        const current = bookmarkAtCurrentPlace(reader);
        if (current !== null) {
          return [
            {
              ...reader,
              bookMenuOpen: false,
              bookmarkMenuOpen: !reader.bookmarkMenuOpen,
              bookmarkJumpMenuOpen: false,
            },
            [],
          ];
        }
        const used = new Set(liveBookmarks(reader).map((bookmark) => bookmark.color));
        const color = BOOKMARK_COLORS.find((candidate) => !used.has(candidate));
        return color === undefined ? [reader, []] : [reader, saveBookmark(reader, null, color)];
      }
      case "ChangedBookmarkColor": {
        const current = bookmarkAtCurrentPlace(reader);
        return current === null
          ? [reader, []]
          : [
              { ...reader, bookmarkMenuOpen: false },
              saveBookmark(reader, current.color, message.color),
            ];
      }
      case "RemovedBookmark": {
        const current = bookmarkAtCurrentPlace(reader);
        return current === null
          ? [reader, []]
          : [{ ...reader, bookmarkMenuOpen: false }, saveBookmark(reader, current.color, null)];
      }
      case "ToggledBookmarkJumpMenu":
        return [
          {
            ...reader,
            bookMenuOpen: false,
            bookmarkJumpMenuOpen: !reader.bookmarkJumpMenuOpen,
            bookmarkMenuOpen: false,
          },
          [],
        ];
      case "JumpedToBookmarkColor": {
        const bookmark = liveBookmarks(reader).find((one) => one.color === message.color);
        return bookmark === undefined
          ? [reader, []]
          : [{ ...reader, bookmarkJumpMenuOpen: false }, goToPlace(reader, bookmark.position)];
      }
      case "ShowedReaderSnapshot":
        return message.sourceId === reader.sourceId
          ? [{ ...reader, snapshot: message.snapshot }, []]
          : [reader, []];
      case "CommittedReaderSelection":
        // The selection becomes a note or a highlight in the notes slice; the
        // reader's part is to let go of it and show the pane it landed in.
        return reader.selection === null
          ? [reader, []]
          : [
              { ...reader, selection: null, pane: "notes" },
              [DismissReaderSelection({ kind: reader.kind })],
            ];
      case "DismissedReaderSelection":
        return [{ ...reader, selection: null }, [DismissReaderSelection({ kind: reader.kind })]];
      case "JumpedToHighlight":
        // Another book's anchor means nothing to this one: the host opens that
        // book and replays the jump once it is ready.
        return message.sourceId === reader.sourceId
          ? [
              { ...reader, pane: "reader" },
              [GoToReaderAnchor({ anchor: message.anchor, kind: reader.kind })],
            ]
          : [reader, []];
      case "ToggledBookMenu":
        return [
          {
            ...reader,
            bookMenuOpen: !reader.bookMenuOpen,
            bookmarkMenuOpen: false,
            bookmarkJumpMenuOpen: false,
          },
          [],
        ];
      case "ClosedBookMenu":
        return [{ ...reader, bookMenuOpen: false }, []];
      case "ClosedReaderMenus":
        return [
          { ...reader, bookMenuOpen: false, bookmarkMenuOpen: false, bookmarkJumpMenuOpen: false },
          [],
        ];
      case "StartedBookRename":
        return [{ ...reader, renamingBook: true, bookTitleDraft: message.title }, []];
      case "ChangedBookTitleDraft":
        return [{ ...reader, bookTitleDraft: message.title }, []];
      case "CancelledBookRename":
        return [{ ...reader, renamingBook: false, bookTitleDraft: "" }, []];
      case "RequestedFitToText":
        return backendFor(reader.kind).fitToText(reader);
      case "SetReaderZoom":
        // FitPdfToText has already applied this zoom to the live mount. This
        // message only reconciles the Model; issuing a normal zoom command
        // here would immediately leave fit mode again.
        return [{ ...reader, zoomPercent: message.percent }, []];
      case "MeasuredReaderPagination":
        return message.place === null ? [reader, []] : [placed(reader, message.place), []];
      case "OpenedEpub": {
        if (message.sourceId !== reader.sourceId) return [reader, []];
        const opened = { ...reader, loading: false, title: message.title, pendingPlace: null };
        return [
          message.place === null ? opened : placed(opened, message.place),
          [
            MeasureEpubPagination({}),
            PaintReaderHighlights({ highlights: reader.highlights, kind: reader.kind }),
            ...goToPlace(opened, reader.pendingPlace),
          ],
        ];
      }
      case "MovedEpub": {
        if (message.sourceId !== reader.sourceId) return [reader, []];
        const moved = placed(reader, message.place);
        return [moved, recordPosition(moved)];
      }
      case "SelectedEpubText":
        return message.sourceId === reader.sourceId
          ? [
              {
                ...reader,
                selection: {
                  anchor: { kind: "epub-cfi", value: message.cfi },
                  quote: message.quote,
                  point: message.point,
                },
              },
              [],
            ]
          : [reader, []];
      case "ClearedEpubSelection":
        return message.sourceId === reader.sourceId
          ? [{ ...reader, selection: null }, []]
          : [reader, []];
      case "ClickedEpubHighlight":
        return message.sourceId === reader.sourceId
          ? [{ ...reader, activeHighlightId: message.highlightId }, []]
          : [reader, []];
      case "FailedEpubLoad":
      case "PdfDocumentLoadFailed":
        return message.sourceId === reader.sourceId
          ? [{ ...reader, loading: false, error: message.message }, []]
          : [reader, []];
      case "PdfDocumentReady":
        return message.sourceId === reader.sourceId
          ? [
              {
                ...reader,
                loading: false,
                title: message.title,
                totalPages: message.totalPages,
                zoomPercent: message.zoom,
                pendingPlace: null,
              },
              goToPlace(reader, reader.pendingPlace),
            ]
          : [reader, []];
      case "PdfSpreadRendered":
        return message.sourceId === reader.sourceId
          ? [
              {
                ...reader,
                page: message.pages[0] ?? 1,
                totalPages: message.total,
                percentage: message.percentage,
                zoomPercent: message.zoom,
                atStart: message.atStart,
                atEnd: message.atEnd,
              },
              // The spread rebuilt its panes, so whatever they held is gone.
              [PaintReaderHighlights({ highlights: reader.highlights, kind: reader.kind })],
            ]
          : [reader, []];
      case "PdfPositionChanged": {
        if (message.sourceId !== reader.sourceId) return [reader, []];
        const moved = { ...reader, position: message.position };
        return [moved, recordPosition(moved)];
      }
      case "PdfSelectionChanged":
        return message.sourceId === reader.sourceId
          ? [
              {
                ...reader,
                selection:
                  message.anchor === null || message.quote === null || message.point === null
                    ? null
                    : { anchor: message.anchor, quote: message.quote, point: message.point },
              },
              [],
            ]
          : [reader, []];
      case "CompletedReaderAction":
        return [reader, []];
    }
  };

  const readerView = <Message>(
    reader: ReaderWorkspace,
    context: ReaderViewContext<Message>,
    h: HtmlBuilder<Message | ReaderMessage>,
  ): Html => {
    const searchCount = reader.searchMatches.length;
    const currentBookmark = bookmarkAtCurrentPlace(reader);
    const currentBookmarks = liveBookmarks(reader);
    const usedBookmarkColors = new Set(currentBookmarks.map((bookmark) => bookmark.color));
    const canAddBookmark =
      reader.position !== null && currentBookmark === null && currentBookmarks.length < 5;
    const mount = backendFor(reader.kind).mount(reader, context);
    const searchRow = h.div(
      [h.Class("reader-search")],
      [
        h.input([
          h.Class("reader-search-input"),
          h.Type("text"),
          h.AriaLabel("Find in book"),
          h.Placeholder("Find in book"),
          h.Autofocus(true),
          h.Value(reader.searchQuery),
          h.OnInput((query) => ChangedReaderSearch({ query })),
          h.OnKeyDownPreventDefault((key, modifiers) =>
            key === "Enter"
              ? Option.some(
                  modifiers.shiftKey
                    ? SelectedSearchMatch({ index: reader.activeSearchMatch - 1 })
                    : RequestedReaderSearch(),
                )
              : key === "Escape"
                ? Option.some(ClosedReaderSearch())
                : key === "ArrowRight" && searchCount > 0
                  ? Option.some(SelectedSearchMatch({ index: reader.activeSearchMatch + 1 }))
                  : key === "ArrowLeft" && searchCount > 0
                    ? Option.some(SelectedSearchMatch({ index: reader.activeSearchMatch - 1 }))
                    : Option.none(),
          ),
        ]),
        h.span(
          [h.Class("reader-search-count"), h.Role("status")],
          [
            searchCount === 0
              ? reader.searchQuery.trim() === ""
                ? ""
                : "0 / 0"
              : `${reader.activeSearchMatch + 1} / ${searchCount}`,
          ],
        ),
        h.button(
          [
            h.Type("button"),
            h.OnClick(SelectedSearchMatch({ index: reader.activeSearchMatch - 1 })),
            h.Disabled(searchCount === 0),
            h.AriaLabel("Previous match"),
            h.Title("Previous match"),
          ],
          ["\u2191"],
        ),
        h.button(
          [
            h.Type("button"),
            h.OnClick(SelectedSearchMatch({ index: reader.activeSearchMatch + 1 })),
            h.Disabled(searchCount === 0),
            h.AriaLabel("Next match"),
            h.Title("Next match"),
          ],
          ["\u2193"],
        ),
        h.button(
          [
            h.Type("button"),
            h.OnClick(ClosedReaderSearch()),
            h.AriaLabel("Close search"),
            h.Title("Close search"),
          ],
          ["\u2715"],
        ),
      ],
    );

    const bookmarkMark = (color: BookmarkColorType | null) =>
      h.svg(
        [h.ViewBox("0 0 24 24"), h.AriaHidden(true)],
        [
          h.path([
            h.D("M6 3h12v18l-6-4-6 4z"),
            h.Fill(color === null ? "none" : `var(--bookmark-${color})`),
            h.Stroke(color === null ? "currentColor" : `var(--bookmark-${color})`),
            h.StrokeWidth("2"),
            h.StrokeLinejoin("round"),
          ]),
        ],
      );
    const bookmarkList = h.svg(
      [h.ViewBox("0 0 24 24"), h.AriaHidden(true)],
      [
        h.path([
          h.D("M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"),
          h.Fill("none"),
          h.Stroke("currentColor"),
          h.StrokeWidth("2"),
          h.StrokeLinecap("round"),
        ]),
      ],
    );
    const colorDot = (color: BookmarkColorType) =>
      h.span([h.Class(`bookmark-color bookmark-color--${color}`), h.AriaHidden(true)], []);
    const bookmarkControls = h.div(
      [h.Class("reader-bookmarks")],
      [
        h.button(
          [
            h.Type("button"),
            h.Class("reader-bookmark-button"),
            h.Disabled(reader.position === null || (!canAddBookmark && currentBookmark === null)),
            h.AriaLabel(currentBookmark === null ? "Bookmark this location" : "Edit this bookmark"),
            h.AriaExpanded(reader.bookmarkMenuOpen),
            h.Title(
              currentBookmark === null
                ? canAddBookmark
                  ? "Bookmark this location"
                  : "All five bookmark colors are in use"
                : `Edit ${currentBookmark.color} bookmark`,
            ),
            h.OnClick(PressedBookmarkButton()),
          ],
          [bookmarkMark(currentBookmark?.color ?? null)],
        ),
        ...(reader.bookmarkMenuOpen && currentBookmark !== null
          ? [
              h.div(
                [h.Class("bookmark-menu"), h.Role("menu"), h.AriaLabel("Edit bookmark")],
                [
                  ...BOOKMARK_COLORS.map((color) =>
                    h.button(
                      [
                        h.Type("button"),
                        h.Role("menuitemradio"),
                        h.AriaChecked(currentBookmark.color === color),
                        h.Disabled(
                          usedBookmarkColors.has(color) && currentBookmark.color !== color,
                        ),
                        h.OnClick(ChangedBookmarkColor({ color })),
                      ],
                      [colorDot(color), color[0].toUpperCase() + color.slice(1)],
                    ),
                  ),
                  h.button(
                    [h.Type("button"), h.Role("menuitem"), h.OnClick(RemovedBookmark())],
                    ["Remove bookmark"],
                  ),
                ],
              ),
            ]
          : []),
        ...(currentBookmarks.length === 0
          ? []
          : [
              h.button(
                [
                  h.Type("button"),
                  h.Class("reader-bookmark-button"),
                  h.AriaLabel("Jump to bookmark"),
                  h.AriaExpanded(reader.bookmarkJumpMenuOpen),
                  h.Title("Jump to bookmark"),
                  h.OnClick(ToggledBookmarkJumpMenu()),
                ],
                [bookmarkList, h.span([h.Class("bookmark-jump-arrow")], ["▾"])],
              ),
            ]),
        ...(reader.bookmarkJumpMenuOpen && currentBookmarks.length > 0
          ? [
              h.div(
                [h.Class("bookmark-menu bookmark-jump-menu"), h.Role("menu")],
                currentBookmarks.map((bookmark) =>
                  h.button(
                    [
                      h.Type("button"),
                      h.Role("menuitem"),
                      h.OnClick(JumpedToBookmarkColor({ color: bookmark.color })),
                    ],
                    [
                      colorDot(bookmark.color),
                      `${bookmark.color[0].toUpperCase() + bookmark.color.slice(1)} · ${
                        bookmark.position.kind === "pdf"
                          ? `page ${bookmark.position.page}`
                          : `${Math.round(bookmark.position.percentage * 100)}%`
                      }`,
                    ],
                  ),
                ),
              ),
            ]
          : []),
      ],
    );

    const toolbar = h.div(
      [h.Class("reader-bar")],
      [
        bookMenu(reader, context, h),
        ...pageCount(reader, h),
        h.span([h.Class("spacer")], []),
        ...readerZoom(reader, h, backendFor(reader.kind).zoom(reader)),
        bookmarkControls,
      ],
    );

    const loadingSurface = reader.loading
      ? reader.snapshot === null
        ? [loadingView(h, "loading--reader")]
        : [
            h.div(
              [h.Class("reader-snapshot"), h.AriaHidden(true)],
              [
                h.img([
                  h.Src(reader.snapshot.dataUrl),
                  h.Width(String(reader.snapshot.width)),
                  h.Height(String(reader.snapshot.height)),
                  h.Alt(""),
                ]),
              ],
            ),
          ]
      : [];
    const surface = h.div(
      [
        // The Mount owns whatever the key identifies: a PDF layout or zoom
        // change rebuilds the document, an EPUB relayouts in place, and a
        // restored place re-seeds either through the generation counter.
        h.Key(backendFor(reader.kind).mountKey(reader)),
        h.OnMount(mount),
        h.Class("reader-surface"),
      ],
      // A snapshot of the last render stands in until the book paints, so
      // reopening a book is not an empty frame.
      loadingSurface,
    );

    const pageTurn = (direction: "previous" | "next") =>
      h.button([
        h.Type("button"),
        h.Class(`reader-page-turn reader-page-turn--${direction === "next" ? "next" : "prev"}`),
        h.OnClick(TurnedReaderPage({ direction })),
        h.AriaLabel(direction === "next" ? "Next page" : "Previous page"),
        h.Title(direction === "next" ? "Next page" : "Previous page"),
      ]);

    return h.section(
      [
        h.AriaLabel("Reader"),
        h.Class(reader.chromeLevel >= 2 ? "reader reader--chrome-hidden" : "reader"),
      ],
      [
        // Chrome hides in two steps, and both are CSS collapses rather than
        // removals, so the bars animate out the way the React reader's do.
        toolbar,
        ...(reader.searchOpen ? [searchRow] : []),
        ...(reader.error === null ? [] : [h.p([h.Role("alert")], [reader.error])]),
        h.div(
          [h.Class("reader-stage")],
          [
            surface,
            ...(reader.loading || reader.atStart ? [] : [pageTurn("previous")]),
            ...(reader.loading || reader.atEnd ? [] : [pageTurn("next")]),
          ],
        ),
        // The selection popup is placed at the point the renderer reported, in
        // viewport coordinates, the same way the React reader places it.
        ...(reader.selection === null
          ? []
          : [
              h.div(
                [
                  h.Class("selection-actions"),
                  h.Style({
                    left: `${reader.selection.point.x}px`,
                    top: `${reader.selection.point.y}px`,
                  }),
                ],
                [
                  h.button(
                    [
                      h.Type("button"),
                      h.Class("add-note label"),
                      h.OnClick(CommittedReaderSelection({ intent: "highlight" })),
                      h.Title("Highlight this selection"),
                    ],
                    ["Highlight"],
                  ),
                  h.button(
                    [
                      h.Type("button"),
                      h.Class("add-note label"),
                      h.OnClick(CommittedReaderSelection({ intent: "note" })),
                      h.Title("Add a note on this selection"),
                    ],
                    ["Add Note"],
                  ),
                ],
              ),
            ]),
      ],
    );
  };

  return { update: updateReader, view: readerView, epub: epubReaderMount, pdf: pdfReaderMount };
};

export type ReaderSlice = ReturnType<typeof makeReaderSlice>;
