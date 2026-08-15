import { Effect, Schema } from "effect";
import { Command } from "foldkit";
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
  makePdfDocumentMount,
} from "./mounts/pdf.ts";

export const ReaderRoute = r("Reader", {
  groupRef: Schema.String,
  sourceId: Schema.String,
  kind: SourceKind,
});

export const ReaderSearchMatch = Schema.Struct({ anchor: HighlightAnchor, excerpt: Schema.String });

export const ReaderWorkspace = Schema.Struct({
  groupRef: Schema.String,
  sourceId: Schema.String,
  kind: SourceKind,
  title: Schema.NullOr(Schema.String),
  loading: Schema.Boolean,
  position: Schema.NullOr(SourceReadingPosition),
  epubPlace: Schema.NullOr(EpubPlace),
  pdfPage: Schema.Number,
  pdfTotalPages: Schema.Number,
  pdfLayout: PdfPageLayout,
  fontSizePercent: Schema.Number,
  searchQuery: Schema.String,
  searchMatches: Schema.Array(ReaderSearchMatch),
  activeSearchMatch: Schema.Number,
  selection: Schema.NullOr(Schema.Struct({ anchor: HighlightAnchor, quote: Schema.String })),
  error: Schema.NullOr(Schema.String),
});
export type ReaderWorkspace = typeof ReaderWorkspace.Type;

export const SelectedReaderSource = m("SelectedReaderSource", {
  groupRef: Schema.String,
  sourceId: Schema.String,
  kind: SourceKind,
});
export const ChangedReaderSearch = m("ChangedReaderSearch", { query: Schema.String });
export const RequestedReaderSearch = m("RequestedReaderSearch");
export const SearchedReader = m("SearchedReader", {
  query: Schema.String,
  matches: Schema.Array(ReaderSearchMatch),
});
export const SelectedSearchMatch = m("SelectedSearchMatch", { index: Schema.Number });
export const ChangedPdfLayout = m("ChangedPdfLayout", { layout: PdfPageLayout });
export const ChangedReaderFontSize = m("ChangedReaderFontSize", { percent: Schema.Number });
export const TurnedReaderPage = m("TurnedReaderPage", {
  direction: Schema.Literals(["next", "previous"]),
});
export const FailedReaderCommand = m("FailedReaderCommand", { message: Schema.String });
export const CompletedReaderAction = m("CompletedReaderAction");

export const ReaderMessage = Schema.Union([
  SelectedReaderSource,
  ChangedReaderSearch,
  RequestedReaderSearch,
  SearchedReader,
  SelectedSearchMatch,
  ChangedPdfLayout,
  ChangedReaderFontSize,
  TurnedReaderPage,
  FailedReaderCommand,
  CompletedReaderAction,
  OpenedEpub,
  MovedEpub,
  SelectedEpubText,
  ClearedEpubSelection,
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

export const epubReaderMount = makeEpubMount({ loadSource: loadCachedBytes });
export const PdfReaderMount = makePdfDocumentMount(browserPdfMountEnvironment(loadCachedBytes));

export const SearchReader = Command.define("SearchReader", {
  args: { query: Schema.String },
  messages: [SearchedReader, FailedReaderCommand],
  execute: ({ query }) =>
    epubReaderMount.reader.search(query).pipe(
      Effect.map((matches) => SearchedReader({ query, matches })),
      Effect.catch((error) => Effect.succeed(FailedReaderCommand({ message: String(error) }))),
    ),
});

export const TurnEpubPage = Command.define("TurnEpubPage", {
  args: { direction: Schema.Literals(["next", "previous"]) },
  messages: [CompletedReaderAction, FailedReaderCommand],
  execute: ({ direction }) =>
    epubReaderMount.turnPage(direction).pipe(
      Effect.as(CompletedReaderAction()),
      Effect.catch((error) => Effect.succeed(FailedReaderCommand({ message: String(error) }))),
    ),
});

export const GoToEpubSearchMatch = Command.define("GoToEpubSearchMatch", {
  args: { anchor: HighlightAnchor },
  messages: [CompletedReaderAction, FailedReaderCommand],
  execute: ({ anchor }) =>
    epubReaderMount.goTo(anchor).pipe(
      Effect.as(CompletedReaderAction()),
      Effect.catch((error) => Effect.succeed(FailedReaderCommand({ message: String(error) }))),
    ),
});

export const SetEpubFontSize = Command.define("SetEpubFontSize", {
  args: { percent: Schema.Number },
  messages: [CompletedReaderAction],
  execute: ({ percent }) =>
    epubReaderMount.setFontSize(percent).pipe(Effect.as(CompletedReaderAction())),
});

export const openReader = (input: typeof SelectedReaderSource.Type): ReaderWorkspace => ({
  groupRef: input.groupRef,
  sourceId: input.sourceId,
  kind: input.kind,
  title: null,
  loading: true,
  position: null,
  epubPlace: null,
  pdfPage: 1,
  pdfTotalPages: 0,
  pdfLayout: "single",
  fontSizePercent: 100,
  searchQuery: "",
  searchMatches: [],
  activeSearchMatch: 0,
  selection: null,
  error: null,
});

export type ReaderUpdate = readonly [
  ReaderWorkspace,
  readonly Command.Command<ReaderMessage, never, never>[],
];

export const updateReader = (
  reader: ReaderWorkspace,
  message: ReaderMessage,
): ReaderUpdate | null => {
  switch (message._tag) {
    case "SelectedReaderSource":
      return [openReader(message), []];
    case "ChangedReaderSearch":
      return [{ ...reader, searchQuery: message.query }, []];
    case "RequestedReaderSearch":
      return reader.kind === "epub"
        ? [reader, [SearchReader({ query: reader.searchQuery })]]
        : null;
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
            reader.kind === "epub" ? [GoToEpubSearchMatch({ anchor: match.anchor })] : [],
          ];
    }
    case "ChangedPdfLayout":
      return [{ ...reader, pdfLayout: message.layout }, []];
    case "ChangedReaderFontSize":
      return reader.kind === "epub"
        ? [
            { ...reader, fontSizePercent: message.percent },
            [SetEpubFontSize({ percent: message.percent })],
          ]
        : null;
    case "TurnedReaderPage":
      return reader.kind === "epub" ? [reader, [TurnEpubPage(message)]] : null;
    case "OpenedEpub":
      return message.sourceId === reader.sourceId
        ? [{ ...reader, loading: false, title: message.title, epubPlace: message.place }, []]
        : [reader, []];
    case "MovedEpub":
      return message.sourceId === reader.sourceId
        ? [{ ...reader, epubPlace: message.place }, []]
        : [reader, []];
    case "SelectedEpubText":
      return message.sourceId === reader.sourceId
        ? [
            {
              ...reader,
              selection: { anchor: { kind: "epub-cfi", value: message.cfi }, quote: message.quote },
            },
            [],
          ]
        : [reader, []];
    case "ClearedEpubSelection":
      return message.sourceId === reader.sourceId
        ? [{ ...reader, selection: null }, []]
        : [reader, []];
    case "FailedEpubLoad":
    case "PdfDocumentLoadFailed":
      return message.sourceId === reader.sourceId
        ? [{ ...reader, loading: false, error: message.message }, []]
        : [reader, []];
    case "PdfDocumentReady":
      return message.sourceId === reader.sourceId
        ? [
            { ...reader, loading: false, title: message.title, pdfTotalPages: message.totalPages },
            [],
          ]
        : [reader, []];
    case "PdfSpreadRendered":
      return message.sourceId === reader.sourceId
        ? [{ ...reader, pdfPage: message.pages[0] ?? 1 }, []]
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

export const readerView = <Message>(
  reader: ReaderWorkspace,
  h: HtmlBuilder<Message | ReaderMessage>,
): Html => {
  const searchCount = reader.searchMatches.length;
  const mount =
    reader.kind === "epub"
      ? epubReaderMount.Mount({
          sourceId: reader.sourceId,
          initialCfi: reader.position?.kind === "epub" ? reader.position.cfi : null,
          spread: "auto",
          fontSizePercent: reader.fontSizePercent,
        })
      : PdfReaderMount({
          sourceId: reader.sourceId,
          initialPage: reader.position?.kind === "pdf" ? reader.position.page : reader.pdfPage,
          zoom: reader.position?.kind === "pdf" ? reader.position.zoom : 100,
          layout: reader.pdfLayout,
        });

  return h.section(
    [h.AriaLabel("Reader"), h.Class("reader-shell")],
    [
      h.h2([], [reader.title ?? "Reader"]),
      h.div(
        [h.Class("reader-toolbar"), h.Role("toolbar"), h.AriaLabel("Reader controls")],
        [
          h.button([h.OnClick(TurnedReaderPage({ direction: "previous" }))], ["Previous page"]),
          h.button([h.OnClick(TurnedReaderPage({ direction: "next" }))], ["Next page"]),
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
            : [
                h.label([h.For("reader-pdf-layout")], ["Page layout"]),
                h.select(
                  [
                    h.Id("reader-pdf-layout"),
                    h.Value(reader.pdfLayout),
                    h.OnChange((layout) =>
                      ChangedPdfLayout({ layout: layout === "auto" ? "auto" : "single" }),
                    ),
                  ],
                  [
                    h.option([h.Value("single")], ["Single page"]),
                    h.option([h.Value("auto")], ["Automatic spread"]),
                  ],
                ),
              ]),
          h.form(
            [h.OnSubmit(RequestedReaderSearch())],
            [
              h.label([h.For("reader-search")], ["Search book"]),
              h.input([
                h.Id("reader-search"),
                h.Type("search"),
                h.Value(reader.searchQuery),
                h.OnInput((query) => ChangedReaderSearch({ query })),
              ]),
              h.button([h.Type("submit")], ["Search"]),
              h.span(
                [h.Role("status")],
                [
                  searchCount === 0
                    ? "No matches"
                    : `${reader.activeSearchMatch + 1} of ${searchCount}`,
                ],
              ),
            ],
          ),
        ],
      ),
      ...(reader.loading ? [h.p([h.Role("status")], ["Loading book"])] : []),
      ...(reader.error === null ? [] : [h.p([h.Role("alert")], [reader.error])]),
      h.div(
        [
          h.Key(`${reader.kind}:${reader.sourceId}:${reader.pdfLayout}`),
          h.OnMount(mount),
          h.Class("reader-surface"),
        ],
        [],
      ),
    ],
  );
};
