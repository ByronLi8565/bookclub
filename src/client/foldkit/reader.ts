import { Effect, Option, Queue, Schedule, Schema, Stream } from "effect";
import { Command, Subscription } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { m } from "foldkit/message";
import { r } from "foldkit/route";
import { HighlightAnchor, QuoteSelector } from "../../shared/types/notes.ts";
import { SourceReadingPosition } from "../../shared/types/readingPositions.ts";
import { SourceKind } from "../../shared/types/sources.ts";
import { PdfPageLayout } from "../../shared/types/userPrefs.ts";
import { getCachedSource } from "../logic/groups/sourceCache.ts";
import { getRenderSnapshot } from "../ui/reader/engine/renderSnapshot.ts";
import {
  browserReaderPositions,
  noReaderPositions,
  type ReaderPositions,
} from "./readerPositions.ts";
import {
  ClearedEpubSelection,
  ClickedEpubHighlight,
  EpubPlace,
  FailedEpubLoad,
  MovedEpub,
  OpenedEpub,
  SelectedEpubText,
  makeEpubMount,
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

export const ReaderRoute = r("Reader", {
  groupRef: Schema.String,
  sourceId: Schema.String,
  kind: SourceKind,
});

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
  epubPlace: Schema.NullOr(EpubPlace),
  /** The measured page count, in the units the reader shows: EPUB presses or
   *  PDF pages. Zero total means "not measured yet". */
  page: Schema.Number,
  totalPages: Schema.Number,
  percentage: Schema.Number,
  atStart: Schema.Boolean,
  atEnd: Schema.Boolean,
  layout: PdfPageLayout,
  /** EPUB text size and PDF zoom are the same control to the reader, but the
   *  renderers take them differently: an EPUB restyles in place, a PDF
   *  re-rasterizes, so its zoom is part of the Mount's element key. */
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
  mountGeneration: Schema.Number,
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
export const ShowedReaderSnapshot = m("ShowedReaderSnapshot", {
  sourceId: Schema.String,
  snapshot: Schema.NullOr(ReaderSnapshotImage),
});
export const CommittedReaderSelection = m("CommittedReaderSelection", {
  intent: Schema.Literals(["note", "highlight"]),
});
export const DismissedReaderSelection = m("DismissedReaderSelection");
export const RequestedFitToText = m("RequestedFitToText");
/** Show a passage the notes pane pointed at. */
export const JumpedToHighlight = m("JumpedToHighlight", { anchor: HighlightAnchor });
export const SetReaderZoom = m("SetReaderZoom", { percent: Schema.Number });
export const FailedReaderCommand = m("FailedReaderCommand", { message: Schema.String });
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
  ShowedReaderSnapshot,
  CommittedReaderSelection,
  DismissedReaderSelection,
  RequestedFitToText,
  JumpedToHighlight,
  SetReaderZoom,
  FailedReaderCommand,
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

const loadCachedBytes = async (sourceId: string): Promise<ArrayBuffer> => {
  const file = await getCachedSource(sourceId);
  if (file === null) throw new Error("This book is not available offline yet.");
  return file.arrayBuffer();
};

/** The reader's one environment dependency: how a source's bytes are found.
 *  Mount args are Schema-only, so this is closed over when the slice is
 *  constructed rather than passed through the Model. */
export interface ReaderEnvironment {
  loadSource: (sourceId: string) => Promise<ArrayBuffer>;
  /** Where the reader's place is kept. A slice built without one opens every
   *  book at the beginning and records nothing. */
  positions?: ReaderPositions;
  /** The last rendered page for a source, used as an opening placeholder. */
  snapshotFor?: (sourceId: string) => ReaderSnapshotImage | null;
}

export const browserReaderEnvironment: ReaderEnvironment = {
  loadSource: loadCachedBytes,
  positions: browserReaderPositions,
  snapshotFor: (sourceId) => {
    const snapshot = getRenderSnapshot(sourceId);
    return snapshot === null
      ? null
      : { dataUrl: snapshot.dataUrl, width: snapshot.width, height: snapshot.height };
  },
};

export const openReader = (input: typeof SelectedReaderSource.Type): ReaderWorkspace => ({
  groupRef: input.groupRef,
  sourceId: input.sourceId,
  kind: input.kind,
  userId: null,
  groupId: null,
  title: null,
  loading: true,
  position: null,
  epubPlace: null,
  page: 0,
  totalPages: 0,
  percentage: 0,
  atStart: true,
  atEnd: false,
  layout: "single",
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
  mountGeneration: 0,
  error: null,
});

export type ReaderUpdate = readonly [
  ReaderWorkspace,
  readonly Command.Command<ReaderMessage, never, never>[],
];

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
  snapshotFor = () => null,
}: ReaderEnvironment) => {
  const epubReaderMount = makeEpubMount({ loadSource });
  const pdfReaderMount = makePdfMount(browserPdfMountEnvironment(loadSource));
  const PdfReaderMount = pdfReaderMount.Mount;

  const epubSpread = (layout: PdfPageLayout) => (layout === "auto" ? "auto" : "none");

  const failed = (error: unknown) => FailedReaderCommand({ message: String(error) });

  const SearchReader = Command.define("SearchReader", {
    args: { query: Schema.String, kind: SourceKind },
    messages: [SearchedReader, FailedReaderCommand],
    execute: ({ query, kind }) =>
      (kind === "epub" ? epubReaderMount.reader.search(query) : pdfReaderMount.search(query)).pipe(
        Effect.map((matches) => SearchedReader({ query, matches })),
        Effect.catch((error) => Effect.succeed(failed(error))),
      ),
  });

  const TurnReaderPage = Command.define("TurnReaderPage", {
    args: { direction: Schema.Literals(["next", "previous"]), kind: SourceKind },
    messages: [CompletedReaderAction, FailedReaderCommand],
    execute: ({ direction, kind }) =>
      (kind === "epub"
        ? epubReaderMount.turnPage(direction)
        : pdfReaderMount.turnPage(direction)
      ).pipe(
        Effect.as(CompletedReaderAction()),
        Effect.catch((error) => Effect.succeed(failed(error))),
      ),
  });

  const GoToSearchMatch = Command.define("GoToSearchMatch", {
    args: { anchor: HighlightAnchor, kind: SourceKind },
    messages: [CompletedReaderAction, FailedReaderCommand],
    execute: ({ anchor, kind }) =>
      (kind === "epub" ? epubReaderMount.goTo(anchor) : pdfReaderMount.goTo(anchor)).pipe(
        Effect.andThen(
          kind === "epub"
            ? epubReaderMount.setSearchHighlight(anchor)
            : pdfReaderMount.setSearchHighlight(anchor),
        ),
        Effect.as(CompletedReaderAction()),
        Effect.catch((error) => Effect.succeed(failed(error))),
      ),
  });

  const GoToReaderAnchor = Command.define("GoToReaderAnchor", {
    args: { anchor: HighlightAnchor, kind: SourceKind },
    messages: [CompletedReaderAction, FailedReaderCommand],
    execute: ({ anchor, kind }) =>
      (kind === "epub" ? epubReaderMount.goTo(anchor) : pdfReaderMount.goTo(anchor)).pipe(
        Effect.as(CompletedReaderAction()),
        Effect.catch((error) => Effect.succeed(failed(error))),
      ),
  });

  const ClearSearchHighlight = Command.define("ClearSearchHighlight", {
    args: { kind: SourceKind },
    messages: [CompletedReaderAction],
    execute: ({ kind }) =>
      (kind === "epub"
        ? epubReaderMount.setSearchHighlight(null)
        : pdfReaderMount.setSearchHighlight(null)
      ).pipe(Effect.as(CompletedReaderAction())),
  });

  const PaintReaderHighlights = Command.define("PaintReaderHighlights", {
    args: { highlights: Schema.Array(ReaderHighlight), kind: SourceKind },
    messages: [CompletedReaderAction],
    execute: ({ highlights, kind }) =>
      (kind === "epub"
        ? epubReaderMount.syncHighlights(
            highlights.flatMap((highlight) =>
              highlight.anchor.kind === "epub-cfi"
                ? [{ id: highlight.id, cfi: highlight.anchor.value }]
                : [],
            ),
          )
        : pdfReaderMount.syncHighlights(highlights)
      ).pipe(Effect.as(CompletedReaderAction())),
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

  const LoadReaderSnapshot = Command.define("LoadReaderSnapshot", {
    args: { sourceId: Schema.String },
    messages: [ShowedReaderSnapshot],
    execute: ({ sourceId }) =>
      Effect.sync(() => ShowedReaderSnapshot({ sourceId, snapshot: snapshotFor(sourceId) })),
  });

  const FitPdfToText = Command.define("FitPdfToText", {
    args: {},
    messages: [SetReaderZoom, CompletedReaderAction],
    execute: () =>
      pdfReaderMount.fitZoom.pipe(
        Effect.map((percent) =>
          percent === null ? CompletedReaderAction() : SetReaderZoom({ percent }),
        ),
      ),
  });

  const DismissReaderSelection = Command.define("DismissReaderSelection", {
    args: { kind: SourceKind },
    messages: [CompletedReaderAction],
    execute: ({ kind }) =>
      (kind === "epub" ? epubReaderMount.dismissSelection : pdfReaderMount.dismissSelection).pipe(
        Effect.as(CompletedReaderAction()),
      ),
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
    messages: [MeasuredReaderPagination, FailedReaderCommand],
    execute: ({ layout }) =>
      epubReaderMount.setSpread(epubSpread(layout)).pipe(
        Effect.andThen(epubReaderMount.measurePagination),
        Effect.map((place) => MeasuredReaderPagination({ place })),
        Effect.catch((error) => Effect.succeed(failed(error))),
      ),
  });

  const MeasureEpubPagination = Command.define("MeasureEpubPagination", {
    args: {},
    messages: [MeasuredReaderPagination, FailedReaderCommand],
    execute: () =>
      epubReaderMount.measurePagination.pipe(
        Effect.map((place) => MeasuredReaderPagination({ place })),
        Effect.catch((error) => Effect.succeed(failed(error))),
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
          : [
              { ...reader, layout: message.layout },
              // A PDF re-renders through a new Mount element key; an EPUB has to
              // be told to relayout the rendition it already owns.
              reader.kind === "epub" ? [SetEpubSpread({ layout: message.layout })] : [],
            ];
      case "ChangedReaderFontSize":
        return reader.kind === "epub"
          ? [
              { ...reader, fontSizePercent: message.percent },
              [SetEpubFontSize({ percent: message.percent }), MeasureEpubPagination({})],
            ]
          : null;
      case "SteppedReaderZoom": {
        const step = message.direction === "in" ? 25 : -25;
        const next = Math.min(
          400,
          Math.max(
            50,
            (reader.kind === "epub" ? reader.fontSizePercent : reader.zoomPercent) + step,
          ),
        );
        return reader.kind === "epub"
          ? updateReader(reader, ChangedReaderFontSize({ percent: next }))
          : [{ ...reader, zoomPercent: next }, []];
      }
      case "TurnedReaderPage":
        return [reader, [TurnReaderPage({ direction: message.direction, kind: reader.kind })]];
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
          ],
        ];
      case "RestoredReaderPosition":
        // A Mount is seeded at insert, so a place that arrives after the book
        // opened only reaches the renderer through a new element key.
        return message.sourceId !== reader.sourceId || message.position === null
          ? [reader, []]
          : [
              {
                ...reader,
                position: message.position,
                mountGeneration: reader.mountGeneration + 1,
              },
              [],
            ];
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
              ],
            ];
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
        return [
          { ...reader, pane: "reader" },
          [GoToReaderAnchor({ anchor: message.anchor, kind: reader.kind })],
        ];
      case "RequestedFitToText":
        return reader.kind === "pdf" ? [reader, [FitPdfToText({})]] : null;
      case "SetReaderZoom":
        return [{ ...reader, zoomPercent: message.percent }, []];
      case "MeasuredReaderPagination":
        return message.place === null ? [reader, []] : [placed(reader, message.place), []];
      case "OpenedEpub": {
        if (message.sourceId !== reader.sourceId) return [reader, []];
        const opened = { ...reader, loading: false, title: message.title };
        return [
          message.place === null ? opened : placed(opened, message.place),
          [
            MeasureEpubPagination({}),
            PaintReaderHighlights({ highlights: reader.highlights, kind: reader.kind }),
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
              { ...reader, loading: false, title: message.title, totalPages: message.totalPages },
              [],
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
      case "FailedReaderCommand":
        return [{ ...reader, error: message.message }, []];
      case "CompletedReaderAction":
        return [reader, []];
    }
  };

  const readerView = <Message>(
    reader: ReaderWorkspace,
    h: HtmlBuilder<Message | ReaderMessage>,
  ): Html => {
    const searchCount = reader.searchMatches.length;
    const mount =
      reader.kind === "epub"
        ? epubReaderMount.Mount({
            sourceId: reader.sourceId,
            initialCfi: reader.position?.kind === "epub" ? reader.position.cfi : null,
            spread: epubSpread(reader.layout),
            fontSizePercent: reader.fontSizePercent,
          })
        : PdfReaderMount({
            sourceId: reader.sourceId,
            initialPage: reader.position?.kind === "pdf" ? reader.position.page : reader.page || 1,
            zoom: reader.zoomPercent,
            layout: reader.layout,
          });
    const searchForm = h.form(
      [h.OnSubmit(RequestedReaderSearch()), h.Class("reader-search")],
      [
        h.label([h.For("reader-search")], ["Find in book"]),
        h.input([
          h.Id("reader-search"),
          h.Type("search"),
          h.Value(reader.searchQuery),
          h.OnInput((query) => ChangedReaderSearch({ query })),
        ]),
        h.button([h.Type("submit")], ["Search"]),
        h.button(
          [
            h.Type("button"),
            h.OnClick(SelectedSearchMatch({ index: reader.activeSearchMatch - 1 })),
            h.AriaLabel("Previous match"),
          ],
          ["Previous match"],
        ),
        h.button(
          [
            h.Type("button"),
            h.OnClick(SelectedSearchMatch({ index: reader.activeSearchMatch + 1 })),
            h.AriaLabel("Next match"),
          ],
          ["Next match"],
        ),
        h.button(
          [h.Type("button"), h.OnClick(ClosedReaderSearch()), h.AriaLabel("Close search")],
          ["Close search"],
        ),
        h.span(
          [h.Class("reader-search-count"), h.Role("status")],
          [searchCount === 0 ? "0 / 0" : `${reader.activeSearchMatch + 1} / ${searchCount}`],
        ),
      ],
    );

    const toolbar = h.div(
      [h.Class("reader-bar"), h.Role("toolbar"), h.AriaLabel("Reader controls")],
      [
        h.span(
          [h.Class("page-count"), h.Role("status")],
          [reader.totalPages === 0 ? "" : `${reader.page} / ${reader.totalPages}`],
        ),
        h.button(
          [h.OnClick(SteppedReaderZoom({ direction: "in" })), h.Title("Increase text size")],
          ["Increase text size"],
        ),
        h.button(
          [h.OnClick(SteppedReaderZoom({ direction: "out" })), h.Title("Decrease text size")],
          ["Decrease text size"],
        ),
        h.span(
          [h.Class("font-size")],
          [`${reader.kind === "epub" ? reader.fontSizePercent : reader.zoomPercent}%`],
        ),
        ...(reader.kind === "epub"
          ? [
              h.label([h.For("reader-font-size")], ["Text size"]),
              h.input([
                h.Id("reader-font-size"),
                h.Type("range"),
                h.Min("75"),
                h.Max("200"),
                h.Value(String(reader.fontSizePercent)),
                h.OnInput((value) => ChangedReaderFontSize({ percent: Number(value) })),
              ]),
            ]
          : []),
        h.label([h.For("reader-layout")], ["Page layout"]),
        h.select(
          [
            h.Id("reader-layout"),
            h.Value(reader.layout),
            h.OnChange((layout) =>
              ChangedReaderLayout({ layout: layout === "auto" ? "auto" : "single" }),
            ),
          ],
          [
            h.option([h.Value("single")], ["Single page"]),
            h.option([h.Value("auto")], ["Automatic spread"]),
          ],
        ),
        h.button([h.OnClick(OpenedReaderSearch()), h.Title("Search")], ["Search"]),
      ],
    );

    const surface = h.div(
      [
        // The Mount owns whatever the key identifies: a PDF layout or zoom
        // change rebuilds the document, an EPUB relayouts in place, and a
        // restored place re-seeds either through the generation counter.
        h.Key(
          reader.kind === "pdf"
            ? `pdf:${reader.sourceId}:${reader.layout}:${reader.zoomPercent}:${reader.mountGeneration}`
            : `epub:${reader.sourceId}:${reader.mountGeneration}`,
        ),
        h.OnMount(mount),
        h.Class("reader-surface"),
      ],
      // A snapshot of the last render stands in until the book paints, so
      // reopening a book is not an empty frame.
      reader.loading && reader.snapshot !== null
        ? [
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
        : [],
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
        ...(reader.searchOpen ? [searchForm] : []),
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
