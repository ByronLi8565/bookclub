// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { PdfRasterCache } from "../client/logic/reader/renderCache.ts";

const raster = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

describe("PDF raster cache", () => {
  it("keeps recently used pixels and releases least-recently-used backing stores", () => {
    const cache = new PdfRasterCache();
    const first = raster(4096, 4096);
    const second = raster(4096, 4096);
    const third = raster(4096, 4096);

    cache.put("first", first);
    cache.put("second", second);
    expect(cache.get("first")).toBe(first);
    cache.put("third", third);

    expect(cache.get("first")).toBe(first);
    expect(cache.get("second")).toBeNull();
    expect(second.width).toBe(0);
    expect(cache.get("third")).toBe(third);
  });

  it("releases every backing store when rendering parameters invalidate the cache", () => {
    const cache = new PdfRasterCache();
    const canvas = raster(100, 120);
    cache.put("page", canvas);

    cache.clear();

    expect(cache.get("page")).toBeNull();
    expect(canvas.width).toBe(0);
  });
});
