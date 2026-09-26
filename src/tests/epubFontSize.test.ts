// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  makeEpubFontSize,
  type ChapterContents,
  type ChapterHost,
} from "../client/logic/reader/epubFontSize.ts";

function chapter(text: string): ChapterContents {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const frameDocument = frame.contentDocument;
  const frameWindow = frame.contentWindow;
  if (!frameDocument || !frameWindow) throw new Error("jsdom did not create a frame document");
  frameDocument.body.innerHTML = `<p style="font-size: 10px">${text}</p>`;
  return { document: frameDocument, window: frameWindow };
}

function fakeRendition() {
  const hooks = new Set<(contents: ChapterContents) => void>();
  let displayed: ChapterContents[] = [];
  const rendition = {
    hooks: {
      content: {
        register: (hook: (contents: ChapterContents) => void) => void hooks.add(hook),
        deregister: (hook: (contents: ChapterContents) => void) => void hooks.delete(hook),
      },
    },
    getContents: () => displayed,
  } satisfies ChapterHost;
  return {
    rendition,
    display(contents: ChapterContents) {
      displayed = [contents];
      for (const hook of hooks) hook(contents);
    },
  };
}

const paragraphSize = (contents: ChapterContents) =>
  contents.document.querySelector("p")?.style.getPropertyValue("font-size");

describe("EPUB font size", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("restyles only the chapters epub.js still displays", () => {
    const { rendition, display } = fakeRendition();
    const fontSize = makeEpubFontSize(rendition, 12);
    const first = chapter("first");
    const second = chapter("second");

    display(first);
    display(second);
    fontSize.set(24);

    expect(paragraphSize(second)).toBe("20px");
    // The chapter the reader left is detached; it keeps the size it had.
    expect(paragraphSize(first)).toBe("10px");
    fontSize.destroy();
  });
});
