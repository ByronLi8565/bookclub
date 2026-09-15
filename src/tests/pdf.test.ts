import { describe, expect, it } from "vitest";
import type { PDFPageProxy } from "pdfjs-dist";
import { JSDOM } from "jsdom";
import { captureHighlight, epubAnchor, pdfAnchor } from "../client/logic/notes/highlights.ts";
import { pageGeometry, pageText } from "../client/logic/sources/pdf.ts";

function textPage(
  items: Array<{ str: string; x?: number; y?: number }>,
  viewBox: [number, number, number, number] = [0, 0, 100, 100],
): PDFPageProxy {
  const [pageX, pageY, right, top] = viewBox;
  const width = right - pageX;
  const height = top - pageY;
  // SAFETY: pageText and pageGeometry only call the two PDFPageProxy methods supplied here.
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
    getViewport: () => ({
      width,
      height,
      convertToViewportPoint: (x: number, y: number) => [x - pageX, top - y],
    }),
  } as PDFPageProxy;
}

describe("PDF text extraction", () => {
  it("inserts spaces between adjacent text items at line boundaries", async () => {
    await expect(
      pageText(textPage([{ str: "delightful" }, { str: "than philosophy" }])),
    ).resolves.toBe("delightful than philosophy");
  });

  it("keeps geometry offsets aligned with inserted boundary spaces", async () => {
    const geometry = await pageGeometry(textPage([{ str: "civilised" }, { str: "form" }]));

    expect(geometry.text).toBe("civilised form");
    expect(geometry.runs.map((run) => run.start)).toEqual([0, 10]);
  });

  it("does not add duplicate spaces around whitespace-only items", async () => {
    await expect(pageText(textPage([{ str: "one" }, { str: " " }, { str: "two" }]))).resolves.toBe(
      "one two",
    );
  });

  it("inserts spaces between selected PDF text layer spans", () => {
    const dom = new JSDOM(
      `<body><div><span>What is</span><span>the chief element</span></div></body>`,
    );
    const range = dom.window.document.createRange();
    const first = dom.window.document.querySelectorAll("span")[0]!.firstChild!;
    const second = dom.window.document.querySelectorAll("span")[1]!.firstChild!;
    range.setStart(first, 0);
    range.setEnd(second, "the chief element".length);

    const highlight = captureHighlight("book", pdfAnchor(1, []), range);

    expect(highlight.quote.exact).toBe("What is the chief element");
  });

  it("preserves ordinary same-node selections", () => {
    const dom = new JSDOM(`<body><p>What is the chief element</p></body>`);
    const range = dom.window.document.createRange();
    const text = dom.window.document.querySelector("p")!.firstChild!;
    range.setStart(text, 5);
    range.setEnd(text, 17);

    const highlight = captureHighlight("book", pdfAnchor(1, []), range);

    expect(highlight.quote.exact).toBe("is the chief");
  });

  it("positions page geometry relative to a non-zero PDF page origin", async () => {
    const geometry = await pageGeometry(
      textPage([{ str: "dragoman", x: 34, y: 46 }], [24, 36, 124, 136]),
    );

    expect(geometry.runs[0]).toMatchObject({ x: 0.1, y: 0.89, width: 0.08, height: 0.01 });
  });

  it("keeps EPUB quote extraction unchanged", () => {
    const dom = new JSDOM(
      `<body><div><span>What is</span><span>the chief element</span></div></body>`,
    );
    const range = dom.window.document.createRange();
    const first = dom.window.document.querySelectorAll("span")[0]!.firstChild!;
    const second = dom.window.document.querySelectorAll("span")[1]!.firstChild!;
    range.setStart(first, 0);
    range.setEnd(second, "the chief element".length);

    const highlight = captureHighlight("book", epubAnchor("epubcfi(/6/2)"), range);

    expect(highlight.quote.exact).toBe("What isthe chief element");
  });
});
