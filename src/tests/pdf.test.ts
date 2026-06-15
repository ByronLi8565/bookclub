import { describe, expect, it } from "vitest";
import type { PDFPageProxy } from "pdfjs-dist";
import { pageGeometry, pageText } from "../client/sources/pdf.ts";

function textPage(items: Array<{ str: string; x?: number; y?: number }>): PDFPageProxy {
  return {
    getTextContent: () =>
      Promise.resolve({
        items: items.map((item) => ({
          str: item.str,
          transform: [1, 0, 0, 1, item.x ?? 0, item.y ?? 0],
          width: item.str.length,
          height: 1,
        })),
      }),
    getViewport: () => ({ width: 100, height: 100 }),
  } as unknown as PDFPageProxy;
}

describe("PDF text extraction", () => {
  it("inserts spaces between adjacent text items at line boundaries", async () => {
    await expect(pageText(textPage([{ str: "delightful" }, { str: "than philosophy" }]))).resolves.toBe(
      "delightful than philosophy",
    );
  });

  it("keeps geometry offsets aligned with inserted boundary spaces", async () => {
    const geometry = await pageGeometry(textPage([{ str: "civilised" }, { str: "form" }]));

    expect(geometry.text).toBe("civilised form");
    expect(geometry.runs.map((run) => run.start)).toEqual([0, 10]);
  });

  it("does not add duplicate spaces around whitespace-only items", async () => {
    await expect(pageText(textPage([{ str: "one" }, { str: " " }, { str: "two" }]))).resolves.toBe("one two");
  });
});
