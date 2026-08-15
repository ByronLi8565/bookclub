import { Runtime } from "foldkit";
import {
  ReaderWorkspace,
  SelectedReaderSource,
  ShowedReaderHighlights,
  makeReaderSlice,
  makeReaderSubscriptions,
  openReader,
  type ReaderMessage,
} from "../../client/foldkit/reader.ts";
import "../../client/index.css";

// The Foldkit counterpart of TestHarness.tsx: it drives the reader slice alone
// against a fixture book, so the browser suite can run the same reading
// scenarios against both entries. jsdom renders neither epub.js nor PDF.js, so
// this harness is the only place the reader's chrome is really checkable.
const HARNESS_SOURCE_ID = "harness";

// The harness reads its book straight from the fixture URL: Playwright's WebKit
// build cannot store a Blob in IndexedDB, so the production source cache is not
// available to it. The byte loader is the slice's one environment dependency,
// which is exactly what makes that substitution possible.
const params = new URLSearchParams(window.location.search);
const book = params.get("book") ?? "/fixtures/moby-dick.pdf";
const kind = book.toLowerCase().endsWith(".pdf") ? "pdf" : "epub";

const subscriptions = makeReaderSubscriptions<ReaderWorkspace, ReaderMessage>({
  modelToReader: (model) => model,
  toMessage: (message) => message,
});

const reader = makeReaderSlice({
  loadSource: async () => {
    const response = await fetch(book);
    if (!response.ok) throw new Error(`fixture ${book} is unavailable`);
    return response.arrayBuffer();
  },
});

const container = document.getElementById("foldkit-reader-harness")!;

Runtime.embed(
  Runtime.makeElement<ReaderWorkspace, ReaderMessage>({
    Model: ReaderWorkspace,
    container,
    init: () => [
      openReader(SelectedReaderSource({ groupRef: "harness", sourceId: HARNESS_SOURCE_ID, kind })),
      [],
    ],
    // The workspace turns a committed selection into a note; the harness has no
    // notes, so it does the one part the reader can be checked against: the
    // highlight the commit is supposed to produce.
    update: (model, message) => {
      const [committed, commands] = reader.update(model, message) ?? [model, []];
      if (message._tag !== "CommittedReaderSelection" || model.selection === null) {
        return [committed, commands];
      }
      const highlights = [
        ...model.highlights,
        { id: `harness-highlight-${model.highlights.length + 1}`, anchor: model.selection.anchor },
      ];
      const [painted, paintCommands] = reader.update(
        committed,
        ShowedReaderHighlights({ highlights }),
      ) ?? [committed, []];
      return [painted, [...commands, ...paintCommands]];
    },
    subscriptions,
    view: (model, h) =>
      h.div(
        // The pane the swipe Subscription has chosen is surfaced for the
        // browser suite; the harness renders no notes pane of its own.
        [
          h.Class(model.chromeLevel >= 1 ? "app app--chrome-hidden" : "app"),
          h.DataAttribute("pane", model.pane),
        ],
        [reader.view(model, h)],
      ),
    devTools: false,
    slow: false,
  }),
);
