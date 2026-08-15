// @vitest-environment jsdom

import { Option } from "effect";
import { describe, expect, it } from "vitest";
import {
  ChangedReaderLayout,
  MeasuredReaderPagination,
  SelectedReaderSource,
  ShowedReaderHighlights,
  SteppedReaderZoom,
  makeReaderSlice,
  openReader,
  readerKeyMessage,
  stepChrome,
  type ReaderMessage,
  type ReaderWorkspace,
} from "../../client/foldkit/reader.ts";
import { PdfSpreadRendered } from "../../client/foldkit/mounts/pdf.ts";
import { epubPageCount } from "../../client/ui/reader/engine/epubPagination.ts";

/** The slice owns live library handles, so a test builds its own with a byte
 *  loader that is never reached: nothing here mounts a document. */
const slice = makeReaderSlice({ loadSource: () => Promise.reject(new Error("not mounted")) });

const update = (
  reader: ReaderWorkspace,
  message: ReaderMessage,
): readonly [ReaderWorkspace, readonly { name: string }[]] =>
  slice.update(reader, message) ?? [reader, []];

const commandNames = (commands: readonly { name: string }[]) =>
  commands.map((command) => command.name);

const epubReader = openReader(
  SelectedReaderSource({ groupRef: "club", sourceId: "source-1", kind: "epub" }),
);
const pdfReader = openReader(
  SelectedReaderSource({ groupRef: "club", sourceId: "source-1", kind: "pdf" }),
);

const highlight = {
  id: "highlight-1",
  anchor: { kind: "epub-cfi" as const, value: "epubcfi(/6/2)" },
};

const key = (init: Partial<KeyboardEventInit> & { key: string }) =>
  new KeyboardEvent("keydown", { cancelable: true, ...init });

describe("reader keyboard contract", () => {
  it("claims the reader's own keys and leaves the rest to the page", () => {
    expect(readerKeyMessage(key({ key: "f", metaKey: true }), false)).toEqual(
      Option.some({ _tag: "OpenedReaderSearch" }),
    );
    expect(readerKeyMessage(key({ key: "ArrowRight" }), false)).toEqual(
      Option.some({ _tag: "TurnedReaderPage", direction: "next" }),
    );
    expect(readerKeyMessage(key({ key: "d" }), false)).toEqual(
      Option.some({ _tag: "ToggledReaderLayout" }),
    );
    expect(readerKeyMessage(key({ key: "z" }), false)).toEqual(
      Option.some({ _tag: "ToggledReaderChrome" }),
    );
    expect(readerKeyMessage(key({ key: "ArrowUp", shiftKey: true }), false)).toEqual(
      Option.some({ _tag: "SteppedReaderChrome", direction: "hide" }),
    );
    expect(readerKeyMessage(key({ key: "q" }), false)).toEqual(Option.none());
    expect(readerKeyMessage(key({ key: "s", metaKey: true }), false)).toEqual(Option.none());
  });

  it("closes search on Escape only while search is open", () => {
    expect(readerKeyMessage(key({ key: "Escape" }), true)).toEqual(
      Option.some({ _tag: "ClosedReaderSearch" }),
    );
    expect(readerKeyMessage(key({ key: "Escape" }), false)).toEqual(Option.none());
  });

  it("leaves typing alone", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const event = key({ key: "d" });
    input.dispatchEvent(event);
    expect(readerKeyMessage(event, false)).toEqual(Option.none());
    input.remove();
  });

  it("steps the chrome without leaving its two levels", () => {
    expect(stepChrome(0, "show")).toBe(0);
    expect(stepChrome(0, "hide")).toBe(1);
    expect(stepChrome(1, "hide")).toBe(2);
    expect(stepChrome(2, "hide")).toBe(2);
    expect(stepChrome(2, "show")).toBe(1);
  });
});

describe("reader annotations", () => {
  it("paints the highlights it is shown and keeps them in the Model", () => {
    const [model, commands] = update(
      epubReader,
      ShowedReaderHighlights({ highlights: [highlight] }),
    );
    expect(model.highlights).toEqual([highlight]);
    expect(commandNames(commands)).toEqual(["PaintReaderHighlights"]);
  });

  it("repaints after a PDF spread rebuilds its panes", () => {
    const [shown] = update(pdfReader, ShowedReaderHighlights({ highlights: [highlight] }));
    const [model, commands] = update(
      shown,
      PdfSpreadRendered({
        sourceId: "source-1",
        pages: [2, 3],
        total: 10,
        spread: true,
        atStart: false,
        atEnd: false,
        percentage: 0.2,
      }),
    );
    expect(model.page).toBe(2);
    expect(model.totalPages).toBe(10);
    expect(commandNames(commands)).toEqual(["PaintReaderHighlights"]);
  });

  it("relayouts an EPUB in place but rebuilds a PDF through its element key", () => {
    const [epub, epubCommands] = update(epubReader, ChangedReaderLayout({ layout: "auto" }));
    expect(epub.layout).toBe("auto");
    expect(commandNames(epubCommands)).toEqual(["SetEpubSpread"]);

    const [pdf, pdfCommands] = update(pdfReader, ChangedReaderLayout({ layout: "auto" }));
    expect(pdf.layout).toBe("auto");
    expect(pdfCommands).toEqual([]);
  });

  it("zooms a PDF through the Model the Mount key is built from", () => {
    const [zoomed] = update(pdfReader, SteppedReaderZoom({ direction: "in" }));
    expect(zoomed.zoomPercent).toBeGreaterThan(pdfReader.zoomPercent);

    const [sized, commands] = update(epubReader, SteppedReaderZoom({ direction: "in" }));
    expect(sized.fontSizePercent).toBeGreaterThan(epubReader.fontSizePercent);
    expect(commandNames(commands)).toEqual(["SetEpubFontSize", "MeasureEpubPagination"]);
  });
});

describe("reader pagination", () => {
  it("shows the measured place once a measurement lands", () => {
    const [model] = update(
      epubReader,
      MeasuredReaderPagination({
        place: {
          spineIndex: 2,
          cfi: "epubcfi(/6/8)",
          page: 3,
          count: { page: 42, total: 200, percentage: 0.21 },
          atStart: false,
          atEnd: false,
        },
      }),
    );
    expect(model.page).toBe(42);
    expect(model.totalPages).toBe(200);
    expect(model.position).toEqual({ kind: "epub", cfi: "epubcfi(/6/8)", percentage: 0.21 });
  });

  it("counts a place as presses through the sections before it", () => {
    const pagination = {
      total: 10,
      divisor: 2,
      offsetByIndex: new Map([
        [0, 0],
        [1, 4],
      ]),
    };
    expect(epubPageCount(pagination, { spineIndex: 1, page: 3 })).toEqual({
      page: 6,
      total: 10,
      percentage: 0.6,
    });
    // Before a measurement lands there is no count to show.
    expect(epubPageCount(null, { spineIndex: 1, page: 3 })).toEqual({
      page: 0,
      total: 0,
      percentage: 0,
    });
  });
});
