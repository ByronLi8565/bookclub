import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { cfiSelector, type Highlight, type SourceReader } from "../../highlights.ts";
import { updateHighlights, type HighlightPainter } from "./highlightReconciler.ts";

// An in-memory painter that records the draw/erase calls made against it.
function fakePainter() {
  const draws: { id: string; cfi: string }[] = [];
  const erases: string[] = [];
  const painter: HighlightPainter = {
    draw: (id, cfi) => void draws.push({ id, cfi }),
    erase: (cfi) => void erases.push(cfi),
  };
  return { painter, draws, erases };
}

// A SourceReader whose resolveCfi answers from a set of cfis it knows about.
function fakeReader(resolvable: Set<string>): SourceReader {
  return {
    resolveCfi: (cfi) => Effect.succeed(resolvable.has(cfi) ? ({} as Range) : null),
    findInSections: () => Effect.succeed(null),
  };
}

function highlight(id: string, cfi: string): Highlight {
  return {
    id,
    sourceId: "book",
    cfi: cfiSelector(cfi),
    quote: { type: "TextQuoteSelector", exact: "x", prefix: "", suffix: "" },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const noRebind = () => {};
const notCancelled = () => false;

describe("updateHighlights", () => {
  it("draws a desired highlight that is not yet drawn", async () => {
    const { painter, draws } = fakePainter();
    const drawn = new Map<string, string>();

    await updateHighlights([{ noteId: "n1", highlight: highlight("h1", "cfi-1") }], drawn, {
      reader: fakeReader(new Set(["cfi-1"])),
      painter,
      rebind: noRebind,
      isCancelled: notCancelled,
    });

    expect(draws).toEqual([{ id: "h1", cfi: "cfi-1" }]);
    expect(drawn.get("h1")).toBe("cfi-1");
  });
});
