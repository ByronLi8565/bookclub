import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import type { PDFPageProxy } from "pdfjs-dist";
import { JSDOM } from "jsdom";
import { captureHighlight, epubAnchor, pdfAnchor } from "../client/notes/highlights.ts";
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

  it("inserts spaces between selected PDF text layer spans", async () => {
    const dom = new JSDOM(`<body><div><span>What is</span><span>the chief element</span></div></body>`);
    const range = dom.window.document.createRange();
    const first = dom.window.document.querySelectorAll("span")[0]!.firstChild!;
    const second = dom.window.document.querySelectorAll("span")[1]!.firstChild!;
    range.setStart(first, 0);
    range.setEnd(second, "the chief element".length);

    const highlight = await Effect.runPromise(captureHighlight("book", pdfAnchor(1, []), range));

    expect(highlight.quote.exact).toBe("What is the chief element");
  });

  it("preserves ordinary same-node selections", async () => {
    const dom = new JSDOM(`<body><p>What is the chief element</p></body>`);
    const range = dom.window.document.createRange();
    const text = dom.window.document.querySelector("p")!.firstChild!;
    range.setStart(text, 5);
    range.setEnd(text, 17);

    const highlight = await Effect.runPromise(captureHighlight("book", pdfAnchor(1, []), range));

    expect(highlight.quote.exact).toBe("is the chief");
  });

  it("keeps EPUB quote extraction unchanged", async () => {
    const dom = new JSDOM(`<body><div><span>What is</span><span>the chief element</span></div></body>`);
    const range = dom.window.document.createRange();
    const first = dom.window.document.querySelectorAll("span")[0]!.firstChild!;
    const second = dom.window.document.querySelectorAll("span")[1]!.firstChild!;
    range.setStart(first, 0);
    range.setEnd(second, "the chief element".length);

    const highlight = await Effect.runPromise(captureHighlight("book", epubAnchor("epubcfi(/6/2)"), range));

    expect(highlight.quote.exact).toBe("What isthe chief element");
  });
});
