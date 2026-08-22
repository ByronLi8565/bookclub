// @vitest-environment jsdom

import { Option } from "effect";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  ChangedReaderLayout,
  CommittedReaderSelection,
  IdentifiedReaderSession,
  ChangedBookmarkColor,
  ClosedReaderMenus,
  JumpedToBookmarkColor,
  PressedBookmarkButton,
  RemovedBookmark,
  RestoredReaderBookmarks,
  RestoredReaderPosition,
  RequestedPositionSync,
  ShowedReaderSnapshot,
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
import { MovedEpub, OpenedEpub } from "../../client/foldkit/mounts/epub.ts";
import { epubPageCount } from "../../client/logic/reader/epubPagination.ts";

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
    expect(readerKeyMessage(key({ key: "s" }), false)).toEqual(
      Option.some({ _tag: "ToggledBookMenu" }),
    );
    // React's Mod+S pushes the reading place to the server there and then.
    expect(readerKeyMessage(key({ key: "s", metaKey: true }), false)).toEqual(
      Option.some({ _tag: "RequestedPositionSync" }),
    );
    expect(readerKeyMessage(key({ key: "q" }), false)).toEqual(Option.none());
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
        zoom: 100,
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

describe("reader bookmarks", () => {
  const placed: ReaderWorkspace = {
    ...epubReader,
    userId: "reader-1",
    groupId: "group-1",
    position: { kind: "epub", cfi: "epubcfi(/6/8)", percentage: 0.21 },
  };
  const red = {
    groupId: "group-1",
    sourceId: "source-1",
    color: "red" as const,
    position: placed.position!,
    updatedAt: "2026-08-22T12:00:00.000Z",
    deletedAt: null,
  };

  it("claims the first free color, then opens the current bookmark menu", () => {
    const [, addCommands] = update(placed, PressedBookmarkButton());
    expect(commandNames(addCommands)).toEqual(["SaveReaderBookmark"]);

    const [restored] = update(
      placed,
      RestoredReaderBookmarks({ sourceId: placed.sourceId, bookmarks: [red] }),
    );
    const [opened, editCommands] = update(restored, PressedBookmarkButton());
    expect(opened.bookmarkMenuOpen).toBe(true);
    expect(editCommands).toEqual([]);
  });

  it("changes or removes the color occupying the current location", () => {
    const bookmarked = { ...placed, bookmarks: [red], bookmarkMenuOpen: true };
    const [changed, changeCommands] = update(bookmarked, ChangedBookmarkColor({ color: "blue" }));
    expect(changed.bookmarkMenuOpen).toBe(false);
    expect(commandNames(changeCommands)).toEqual(["SaveReaderBookmark"]);

    const [, removeCommands] = update(bookmarked, RemovedBookmark());
    expect(commandNames(removeCommands)).toEqual(["SaveReaderBookmark"]);
  });

  it("recognizes an EPUB text anchor anywhere in the current page or spread", () => {
    const anchored = {
      ...red,
      position: { kind: "epub" as const, cfi: "epubcfi(/6/8!/4/6)", percentage: 0.21 },
    };
    const bookmarked = {
      ...placed,
      page: 21,
      totalPages: 100,
      position: { kind: "epub" as const, cfi: "epubcfi(/6/8!/4/2)", percentage: 0.21 },
      epubPlace: {
        spineIndex: 3,
        cfi: "epubcfi(/6/8!/4/2)",
        endCfi: "epubcfi(/6/8!/4/8)",
        page: 1,
        count: { page: 21, total: 100, percentage: 0.21 },
        atStart: false,
        atEnd: false,
      },
      bookmarks: [anchored],
    };

    const [opened] = update(bookmarked, PressedBookmarkButton());
    expect(opened.bookmarkMenuOpen).toBe(true);

    const [adjacent] = update(
      {
        ...bookmarked,
        epubPlace: {
          ...bookmarked.epubPlace,
          cfi: "epubcfi(/6/8!/4/10)",
          endCfi: "epubcfi(/6/8!/4/14)",
        },
      },
      PressedBookmarkButton(),
    );
    expect(adjacent.bookmarkMenuOpen).toBe(false);
  });

  it("uses the rendered PDF page while its position recorder catches up", () => {
    const blue = {
      groupId: "group-1",
      sourceId: "source-1",
      color: "blue" as const,
      position: { kind: "pdf" as const, page: 5, scrollRatio: 0, zoom: 100, percentage: 0.4 },
      updatedAt: "2026-08-22T12:00:00.000Z",
      deletedAt: null,
    };
    const catchingUp = {
      ...pdfReader,
      page: 5,
      position: { ...blue.position, page: 4 },
      bookmarks: [blue],
    };

    const [opened] = update(catchingUp, PressedBookmarkButton());
    expect(opened.bookmarkMenuOpen).toBe(true);
  });

  it("jumps to a bookmark by color", () => {
    const bookmarked = { ...placed, bookmarks: [red], bookmarkJumpMenuOpen: true };
    const [jumped, commands] = update(bookmarked, JumpedToBookmarkColor({ color: "red" }));
    expect(jumped.bookmarkJumpMenuOpen).toBe(false);
    expect(commandNames(commands)).toEqual(["GoToReaderAnchor"]);
  });

  it("closes every toolbar menu on an outside press", () => {
    const [closed] = update(
      { ...placed, bookMenuOpen: true, bookmarkMenuOpen: true, bookmarkJumpMenuOpen: true },
      ClosedReaderMenus(),
    );
    expect({
      book: closed.bookMenuOpen,
      edit: closed.bookmarkMenuOpen,
      jump: closed.bookmarkJumpMenuOpen,
    }).toEqual({ book: false, edit: false, jump: false });
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

describe("reader place", () => {
  const recorded: unknown[] = [];
  const synced: unknown[] = [];
  const identified = makeReaderSlice({
    loadSource: () => Promise.reject(new Error("not mounted")),
    positions: {
      restore: () => Effect.succeed({ kind: "epub", cfi: "epubcfi(/6/8)", percentage: 0.5 }),
      record: (input) =>
        Effect.sync(() => {
          recorded.push(input);
        }),
      sync: (input) =>
        Effect.sync(() => {
          synced.push(input);
        }),
    },
    snapshotFor: () =>
      Promise.resolve({ dataUrl: "data:image/webp;base64,AA", width: 40, height: 60 }),
  });
  const run = (
    reader: ReaderWorkspace,
    message: ReaderMessage,
  ): readonly [ReaderWorkspace, readonly { name: string }[]] =>
    identified.update(reader, message) ?? [reader, []];

  it("asks for the reader's place only once it knows who is reading", () => {
    const [before, beforeCommands] = run(epubReader, RequestedPositionSync());
    expect(before.userId).toBeNull();
    expect(commandNames(beforeCommands)).toEqual([]);

    const [known, commands] = run(
      epubReader,
      IdentifiedReaderSession({ userId: "reader-1", groupId: "group-1" }),
    );
    expect(known.userId).toBe("reader-1");
    expect(commandNames(commands)).toEqual(["RestoreReaderPosition", "RestoreReaderBookmarks"]);

    expect(commandNames(run(known, RequestedPositionSync())[1])).toEqual([
      "SyncReaderPosition",
      "SyncReaderBookmarks",
    ]);
  });

  it("moves the open book to a restored place instead of rebuilding it", () => {
    // Rebuilding the session around a new element key downloads and opens the
    // book a second time, and destroys the first while it is still opening.
    const opened = run(
      epubReader,
      OpenedEpub({ sourceId: epubReader.sourceId, title: "Dorian", place: null }),
    )[0];
    expect(opened.loading).toBe(false);

    const [restored, commands] = run(
      opened,
      RestoredReaderPosition({
        sourceId: epubReader.sourceId,
        position: { kind: "epub", cfi: "epubcfi(/6/8)", percentage: 0.5 },
      }),
    );
    expect(restored.position).toEqual({ kind: "epub", cfi: "epubcfi(/6/8)", percentage: 0.5 });
    expect(commandNames(commands)).toEqual(["GoToReaderAnchor"]);
    expect(restored.pendingPlace).toBeNull();

    // A place for a book the reader is no longer showing changes nothing.
    const [other, otherCommands] = run(
      restored,
      RestoredReaderPosition({
        sourceId: "another-source",
        position: { kind: "epub", cfi: "epubcfi(/6/2)", percentage: 0.1 },
      }),
    );
    expect(other.position).toEqual(restored.position);
    expect(commandNames(otherCommands)).toEqual([]);
  });

  it("holds a restored place that arrives before the book has opened", () => {
    // Nothing has displayed yet, so there is nowhere to navigate to; the place
    // waits for the book rather than being dropped or forcing a remount.
    const [waiting, waitingCommands] = run(
      epubReader,
      RestoredReaderPosition({
        sourceId: epubReader.sourceId,
        position: { kind: "epub", cfi: "epubcfi(/6/8)", percentage: 0.5 },
      }),
    );
    expect(waiting.loading).toBe(true);
    expect(waiting.pendingPlace).toEqual({ kind: "epub", cfi: "epubcfi(/6/8)", percentage: 0.5 });
    expect(commandNames(waitingCommands)).toEqual([]);

    const [open, openCommands] = run(
      waiting,
      OpenedEpub({ sourceId: epubReader.sourceId, title: "Dorian", place: null }),
    );
    expect(open.pendingPlace).toBeNull();
    expect(commandNames(openCommands)).toContain("GoToReaderAnchor");
  });

  it("records every reported place, but only for an identified reader", () => {
    const place = {
      spineIndex: 1,
      cfi: "epubcfi(/6/4)",
      page: 2,
      count: { page: 5, total: 100, percentage: 0.05 },
      atStart: false,
      atEnd: false,
    };
    expect(
      commandNames(run(epubReader, MovedEpub({ sourceId: epubReader.sourceId, place }))[1]),
    ).toEqual([]);

    const [known] = run(
      epubReader,
      IdentifiedReaderSession({ userId: "reader-1", groupId: "group-1" }),
    );
    expect(commandNames(run(known, MovedEpub({ sourceId: known.sourceId, place }))[1])).toEqual([
      "RecordReaderPosition",
    ]);
  });

  it("shows the last rendered page while the next open is still loading", () => {
    expect(commandNames(run(epubReader, SelectedReaderSource(epubReader))[1])).toEqual([
      "LoadReaderSnapshot",
    ]);
    const [shown] = run(
      epubReader,
      ShowedReaderSnapshot({
        sourceId: epubReader.sourceId,
        snapshot: { dataUrl: "data:image/webp;base64,AA", width: 40, height: 60 },
      }),
    );
    expect(shown.snapshot?.width).toBe(40);
  });

  it("hands a committed selection over and stops showing it", () => {
    const selecting: ReaderWorkspace = {
      ...epubReader,
      selection: {
        anchor: { kind: "epub-cfi", value: "epubcfi(/6/2)" },
        quote: { type: "TextQuoteSelector", exact: "a passage", prefix: "", suffix: "" },
        point: { x: 10, y: 20 },
      },
    };
    const [committed, commands] = run(selecting, CommittedReaderSelection({ intent: "note" }));
    expect(committed.selection).toBeNull();
    // A committed selection is read in the notes pane, so that is where the
    // phone layout lands.
    expect(committed.pane).toBe("notes");
    expect(commandNames(commands)).toEqual(["DismissReaderSelection"]);
  });
});
