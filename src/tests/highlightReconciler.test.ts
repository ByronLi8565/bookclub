import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import {
  epubAnchor,
  type Highlight,
  type HighlightAnchor,
  type SourceReader,
} from "../client/logic/notes/highlights.ts";
import {
  updateHighlights,
  type HighlightPainter,
} from "../client/ui/reader/engine/highlightReconciler.ts";

function fakePainter() {
  const draws: { id: string; anchor: HighlightAnchor }[] = [];
  const erases: string[] = [];
  const painter: HighlightPainter = {
    draw: (id, anchor) => void draws.push({ id, anchor }),
    erase: (id) => void erases.push(id),
  };
  return { painter, draws, erases };
}

function fakeReader(resolvable: Set<string>): SourceReader {
  return {
    locateHighlight: (h) =>
      Effect.succeed(
        h.anchor.kind === "epub-cfi" && resolvable.has(h.anchor.value) ? h.anchor : null,
      ),
    search: () => Effect.succeed([]),
  };
}

function highlight(id: string, cfi: string): Highlight {
  return {
    id,
    sourceId: "book",
    anchor: epubAnchor(cfi),
    quote: { type: "TextQuoteSelector", exact: "x", prefix: "", suffix: "" },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const noRebind = () => {};
const notCancelled = () => false;
const runUpdateHighlights = (...args: Parameters<typeof updateHighlights>) =>
  Effect.runPromise(updateHighlights(...args));

describe("updateHighlights", () => {
  it("draws a desired highlight that is not yet drawn", async () => {
    const { painter, draws } = fakePainter();
    const drawn = new Map<string, HighlightAnchor>();

    await runUpdateHighlights(
      [{ noteId: "n1", highlight: highlight("h1", "cfi-1"), canRebind: true }],
      drawn,
      {
        reader: fakeReader(new Set(["cfi-1"])),
        painter,
        rebind: noRebind,
        isCancelled: notCancelled,
      },
    );

    expect(draws).toEqual([{ id: "h1", anchor: epubAnchor("cfi-1") }]);
    expect(drawn.get("h1")).toEqual(epubAnchor("cfi-1"));
  });

  it("erases a drawn highlight that is no longer desired", async () => {
    const { painter, erases } = fakePainter();
    const drawn = new Map<string, HighlightAnchor>([["gone", epubAnchor("cfi-gone")]]);

    await runUpdateHighlights([], drawn, {
      reader: fakeReader(new Set()),
      painter,
      rebind: noRebind,
      isCancelled: notCancelled,
    });

    expect(erases).toEqual(["gone"]);
    expect(drawn.has("gone")).toBe(false);
  });

  it("leaves an already-drawn highlight untouched", async () => {
    const { painter, draws, erases } = fakePainter();
    const drawn = new Map<string, HighlightAnchor>([["h1", epubAnchor("cfi-1")]]);
    let located = 0;
    const reader: SourceReader = {
      locateHighlight: (h) => {
        located++;
        return Effect.succeed(h.anchor);
      },
      search: () => Effect.succeed([]),
    };

    await runUpdateHighlights(
      [{ noteId: "n1", highlight: highlight("h1", "cfi-1"), canRebind: true }],
      drawn,
      { reader, painter, rebind: noRebind, isCancelled: notCancelled },
    );

    expect(draws).toEqual([]);
    expect(erases).toEqual([]);
    expect(located).toBe(0);
  });

  it("repaints an existing highlight when its stored anchor changes", async () => {
    const { painter, draws, erases } = fakePainter();
    const drawn = new Map<string, HighlightAnchor>([["h1", epubAnchor("cfi-old")]]);

    await runUpdateHighlights(
      [{ noteId: "n1", highlight: highlight("h1", "cfi-new"), canRebind: true }],
      drawn,
      {
        reader: fakeReader(new Set(["cfi-new"])),
        painter,
        rebind: noRebind,
        isCancelled: notCancelled,
      },
    );

    expect(erases).toEqual(["h1"]);
    expect(draws).toEqual([{ id: "h1", anchor: epubAnchor("cfi-new") }]);
    expect(drawn.get("h1")).toEqual(epubAnchor("cfi-new"));
  });

  it("rebinds and paints at the fresh anchor when the stored one has drifted", async () => {
    const { painter, draws } = fakePainter();
    const drawn = new Map<string, HighlightAnchor>();
    const rebinds: { noteId: string; highlightId: string; anchor: HighlightAnchor }[] = [];

    const reader: SourceReader = {
      locateHighlight: () => Effect.succeed(epubAnchor("cfi-fresh")),
      search: () => Effect.succeed([]),
    };

    await runUpdateHighlights(
      [{ noteId: "n1", highlight: highlight("h1", "cfi-old"), canRebind: true }],
      drawn,
      {
        reader,
        painter,
        rebind: (noteId, highlightId, anchor) => void rebinds.push({ noteId, highlightId, anchor }),
        isCancelled: notCancelled,
      },
    );

    expect(rebinds).toEqual([{ noteId: "n1", highlightId: "h1", anchor: epubAnchor("cfi-fresh") }]);
    expect(draws).toEqual([{ id: "h1", anchor: epubAnchor("cfi-fresh") }]);
    expect(drawn.get("h1")).toEqual(epubAnchor("cfi-fresh"));
  });

  it("paints but does not rebind another author's drifting highlight", async () => {
    const { painter, draws } = fakePainter();
    const rebinds: string[] = [];
    const reader: SourceReader = {
      locateHighlight: () => Effect.succeed(epubAnchor("cfi-fresh")),
      search: () => Effect.succeed([]),
    };

    await runUpdateHighlights(
      [{ noteId: "n1", highlight: highlight("h1", "cfi-old"), canRebind: false }],
      new Map(),
      {
        reader,
        painter,
        rebind: (_noteId, highlightId) => void rebinds.push(highlightId),
        isCancelled: notCancelled,
      },
    );

    expect(rebinds).toEqual([]);
    expect(draws).toEqual([{ id: "h1", anchor: epubAnchor("cfi-fresh") }]);
  });

  it("skips a highlight that cannot be located", async () => {
    const { painter, draws } = fakePainter();
    const drawn = new Map<string, HighlightAnchor>();
    const rebinds: string[] = [];
    const reader: SourceReader = {
      locateHighlight: () => Effect.succeed(null),
      search: () => Effect.succeed([]),
    };

    await runUpdateHighlights(
      [{ noteId: "n1", highlight: highlight("h1", "cfi-old"), canRebind: true }],
      drawn,
      { reader, painter, rebind: (_n, id) => void rebinds.push(id), isCancelled: notCancelled },
    );

    expect(draws).toEqual([]);
    expect(rebinds).toEqual([]);
    expect(drawn.has("h1")).toBe(false);
  });

  it("never rebinds the composing highlight, even when its anchor drifts", async () => {
    const { painter, draws } = fakePainter();
    const drawn = new Map<string, HighlightAnchor>();
    const rebinds: string[] = [];
    const reader: SourceReader = {
      locateHighlight: () => Effect.succeed(epubAnchor("cfi-fresh")),
      search: () => Effect.succeed([]),
    };

    await runUpdateHighlights(
      [{ noteId: null, highlight: highlight("draft", "cfi-old"), canRebind: false }],
      drawn,
      { reader, painter, rebind: (_n, id) => void rebinds.push(id), isCancelled: notCancelled },
    );

    expect(rebinds).toEqual([]);
    expect(draws).toEqual([{ id: "draft", anchor: epubAnchor("cfi-fresh") }]);
  });

  it("stops drawing once cancelled", async () => {
    const { painter, draws } = fakePainter();
    const drawn = new Map<string, HighlightAnchor>();

    await runUpdateHighlights(
      [
        { noteId: "n1", highlight: highlight("h1", "cfi-1"), canRebind: true },
        { noteId: "n2", highlight: highlight("h2", "cfi-2"), canRebind: true },
      ],
      drawn,
      {
        reader: fakeReader(new Set(["cfi-1", "cfi-2"])),
        painter,
        rebind: noRebind,

        isCancelled: () => draws.length > 0,
      },
    );

    expect(draws).toEqual([{ id: "h1", anchor: epubAnchor("cfi-1") }]);
  });

  it("does not draw a result that arrived after cancellation", async () => {
    const { painter, draws } = fakePainter();
    const drawn = new Map<string, HighlightAnchor>();
    let cancelled = false;

    const reader: SourceReader = {
      locateHighlight: (h) =>
        Effect.sync(() => {
          cancelled = true;
          return h.anchor;
        }),
      search: () => Effect.succeed([]),
    };

    await runUpdateHighlights(
      [{ noteId: "n1", highlight: highlight("h1", "cfi-1"), canRebind: true }],
      drawn,
      { reader, painter, rebind: noRebind, isCancelled: () => cancelled },
    );

    expect(draws).toEqual([]);
    expect(drawn.has("h1")).toBe(false);
  });
});
