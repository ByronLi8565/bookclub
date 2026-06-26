import { describe, expect, it } from "vitest";
import {
  cropBox,
  MIN_SPREAD_PANE_WIDTH,
  SPREAD_GUTTER_PX,
  spreadEnd,
  spreadFits,
  spreadPages,
  spreadStart,
} from "../client/ui/reader/engine/pdfSpread.ts";

// The viewport width at which two panes each exactly hit the minimum width.
const FITS_WIDTH = MIN_SPREAD_PANE_WIDTH * 2 + SPREAD_GUTTER_PX;

describe("spreadFits", () => {
  it("never spreads in single-page layout", () => {
    expect(spreadFits("single", 500, 4000)).toBe(false);
  });

  it("never spreads a one-page document", () => {
    expect(spreadFits("auto", 1, 4000)).toBe(false);
  });

  it("spreads when auto and the viewport is wide enough", () => {
    expect(spreadFits("auto", 2, FITS_WIDTH)).toBe(true);
    expect(spreadFits("auto", 300, 1400)).toBe(true);
  });

  it("falls back to single page when each pane would be too narrow", () => {
    expect(spreadFits("auto", 300, FITS_WIDTH - 1)).toBe(false);
    expect(spreadFits("auto", 300, 390)).toBe(false); // phone-width
  });

  it("requires a genuinely wide viewport (threshold is not too generous)", () => {
    // A typical split laptop reader pane (~760px) must NOT trigger a spread.
    expect(spreadFits("auto", 300, 760)).toBe(false);
    expect(MIN_SPREAD_PANE_WIDTH).toBeGreaterThanOrEqual(440);
  });
});

describe("cropBox", () => {
  const pageW = 600;
  const pageH = 800;
  const pad = 10;

  it("crops to text bounds with padding on each cropped side", () => {
    const crop = cropBox({ minX: 0.1, maxX: 0.9 }, { minY: 0.2, maxY: 0.8 }, pageW, pageH, pad);
    expect(crop.left).toBe(0.1 * pageW - pad); // 50
    expect(crop.top).toBe(0.2 * pageH - pad); // 150
    expect(crop.width).toBe(0.8 * pageW + 2 * pad); // 500
    expect(crop.height).toBe(0.6 * pageH + 2 * pad); // 500
  });

  it("never pads past the page edges", () => {
    const crop = cropBox({ minX: 0, maxX: 1 }, { minY: 0, maxY: 1 }, pageW, pageH, pad);
    expect(crop).toEqual({ left: 0, top: 0, width: pageW, height: pageH });
  });

  it("leaves an axis full when its bounds are null (scanned page)", () => {
    const crop = cropBox(null, { minY: 0.25, maxY: 0.75 }, pageW, pageH, pad);
    expect(crop.left).toBe(0);
    expect(crop.width).toBe(pageW);
    expect(crop.top).toBe(0.25 * pageH - pad);
    expect(crop.height).toBe(0.5 * pageH + 2 * pad);
  });

  it("returns the whole page when both axes are null (single-page mode)", () => {
    expect(cropBox(null, null, pageW, pageH, pad)).toEqual({
      left: 0,
      top: 0,
      width: pageW,
      height: pageH,
    });
  });
});

describe("spreadStart", () => {
  it("is the identity when spreads are disabled", () => {
    for (const p of [1, 2, 3, 4, 17]) expect(spreadStart(p, false)).toBe(p);
  });

  it("keeps the cover (page 1) alone", () => {
    expect(spreadStart(1, true)).toBe(1);
  });

  it("snaps to the even left page of each opening", () => {
    expect(spreadStart(2, true)).toBe(2);
    expect(spreadStart(3, true)).toBe(2);
    expect(spreadStart(4, true)).toBe(4);
    expect(spreadStart(5, true)).toBe(4);
  });

  it("clamps non-positive pages to 1", () => {
    expect(spreadStart(0, true)).toBe(1);
    expect(spreadStart(-3, false)).toBe(1);
  });
});

describe("spreadPages", () => {
  it("returns a single page when disabled", () => {
    expect(spreadPages(4, false, 10)).toEqual([4]);
  });

  it("keeps the cover solo", () => {
    expect(spreadPages(1, true, 10)).toEqual([1]);
  });

  it("pairs interior openings", () => {
    expect(spreadPages(2, true, 10)).toEqual([2, 3]);
    expect(spreadPages(4, true, 10)).toEqual([4, 5]);
  });

  it("leaves a trailing odd page solo", () => {
    // 10 pages: cover [1], (2,3)…(8,9), then [10] alone.
    expect(spreadPages(10, true, 10)).toEqual([10]);
  });
});

describe("spreadEnd", () => {
  it("is the page itself when solo", () => {
    expect(spreadEnd(1, true, 10)).toBe(1);
    expect(spreadEnd(10, true, 10)).toBe(10);
    expect(spreadEnd(4, false, 10)).toBe(4);
  });

  it("is the right page of a pair", () => {
    expect(spreadEnd(2, true, 10)).toBe(3);
    expect(spreadEnd(8, true, 10)).toBe(9);
  });
});

// The reader navigates by computing the next/prev target the same way the hook
// does: next = spreadEnd(left) + 1, prev = spreadStart(left) - 1, each then
// normalised through spreadStart. This walks a 10-page book forward and back.
function nextLeft(left: number, enabled: boolean, numPages: number): number {
  return spreadStart(Math.min(numPages, spreadEnd(left, enabled, numPages) + 1), enabled);
}
function prevLeft(left: number, enabled: boolean): number {
  return spreadStart(Math.max(1, spreadStart(left, enabled) - 1), enabled);
}

describe("spread navigation", () => {
  it("walks forward cover → pairs → trailing odd page", () => {
    const pages = 10;
    const seq = [1];
    let left = 1;
    for (let i = 0; i < 6; i++) {
      left = nextLeft(left, true, pages);
      seq.push(left);
    }
    expect(seq).toEqual([1, 2, 4, 6, 8, 10, 10]);
  });

  it("walks backward symmetrically", () => {
    const seq = [10];
    let left = 10;
    for (let i = 0; i < 6; i++) {
      left = prevLeft(left, true);
      seq.push(left);
    }
    expect(seq).toEqual([10, 8, 6, 4, 2, 1, 1]);
  });

  it("steps one page at a time when spreads are off", () => {
    let left = 1;
    const seq = [left];
    for (let i = 0; i < 3; i++) {
      left = nextLeft(left, false, 10);
      seq.push(left);
    }
    expect(seq).toEqual([1, 2, 3, 4]);
  });

  it("handles an odd-length book without skipping the last page", () => {
    const pages = 7; // cover [1], (2,3),(4,5),(6,7)
    const visited = new Set<number>();
    let left = 1;
    for (let i = 0; i < 10; i++) {
      for (const p of spreadPages(left, true, pages)) visited.add(p);
      left = nextLeft(left, true, pages);
    }
    expect([...visited].toSorted((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
