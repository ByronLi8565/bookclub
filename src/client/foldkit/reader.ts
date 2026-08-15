import { Effect, Option, Queue, Schema, Stream } from "effect";
import { Command, Subscription } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { m } from "foldkit/message";
import { r } from "foldkit/route";
import { HighlightAnchor } from "../../shared/types/notes.ts";
import { SourceReadingPosition } from "../../shared/types/readingPositions.ts";
import { SourceKind } from "../../shared/types/sources.ts";
import { PdfPageLayout } from "../../shared/types/userPrefs.ts";
import { getCachedSource } from "../logic/groups/sourceCache.ts";
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

export const ReaderWorkspace = Schema.Struct({
  groupRef: Schema.String,
  sourceId: Schema.String,
  kind: SourceKind,
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
  selection: Schema.NullOr(Schema.Struct({ anchor: HighlightAnchor, quote: Schema.String })),
  chromeLevel: ChromeLevel,
  pane: ReaderPane,
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
}

export const browserReaderEnvironment: ReaderEnvironment = { loadSource: loadCachedBytes };

export const openReader = (input: typeof SelectedReaderSource.Type): ReaderWorkspace => ({
  groupRef: input.groupRef,
  sourceId: input.sourceId,
  kind: input.kind,
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
export const makeReaderSlice = ({ loadSource }: ReaderEnvironment) => {
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

  const updateReader = (reader: ReaderWorkspace, message: ReaderMessage): ReaderUpdate | null => {
    switch (message._tag) {
      case "SelectedReaderSource":
        return [openReader(message), []];
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
      case "MovedEpub":
        return message.sourceId === reader.sourceId
          ? [placed(reader, message.place), []]
          : [reader, []];
      case "SelectedEpubText":
        return message.sourceId === reader.sourceId
          ? [
              {
                ...reader,
                selection: {
                  anchor: { kind: "epub-cfi", value: message.cfi },
                  quote: message.quote,
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
      case "PdfPositionChanged":
        return message.sourceId === reader.sourceId
          ? [{ ...reader, position: message.position }, []]
          : [reader, []];
      case "PdfSelectionChanged":
        return message.sourceId === reader.sourceId
          ? [
              {
                ...reader,
                selection:
                  message.anchor === null
                    ? null
                    : { anchor: message.anchor, quote: "Selected PDF text" },
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
      [h.Class("reader-toolbar"), h.Role("toolbar"), h.AriaLabel("Reader controls")],
      [
        h.button(
          [h.OnClick(TurnedReaderPage({ direction: "previous" })), h.Title("Previous page")],
          ["Previous page"],
        ),
        h.button(
          [h.OnClick(TurnedReaderPage({ direction: "next" })), h.Title("Next page")],
          ["Next page"],
        ),
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
        ...(reader.searchOpen ? [searchForm] : []),
      ],
    );

    return h.section(
      [
        h.AriaLabel("Reader"),
        h.Class(reader.chromeLevel >= 1 ? "reader-shell reader--chrome-hidden" : "reader-shell"),
      ],
      [
        h.h2([], [reader.title ?? "Reader"]),
        // Chrome hides in two steps: the app chrome first, the reader's own
        // toolbar second.
        ...(reader.chromeLevel >= 2 ? [] : [toolbar]),
        ...(reader.loading ? [h.p([h.Role("status")], ["Loading book"])] : []),
        ...(reader.error === null ? [] : [h.p([h.Role("alert")], [reader.error])]),
        h.div(
          [
            // The Mount owns whatever the key identifies; a PDF layout change
            // rebuilds the document, while an EPUB relayouts in place.
            h.Key(
              reader.kind === "pdf"
                ? `pdf:${reader.sourceId}:${reader.layout}:${reader.zoomPercent}`
                : `epub:${reader.sourceId}`,
            ),
            h.OnMount(mount),
            h.Class("reader-surface"),
          ],
          [],
        ),
      ],
    );
  };

  return { update: updateReader, view: readerView, epub: epubReaderMount, pdf: pdfReaderMount };
};

export type ReaderSlice = ReturnType<typeof makeReaderSlice>;
