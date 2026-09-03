import type { Contents, Rendition } from "epubjs";

interface SizedElement {
  readonly element: HTMLElement;
  readonly baselinePixels: number;
}

interface SizedDocument {
  readonly contents: Contents;
  readonly elements: SizedElement[];
}

/**
 * epub.js changes only the body font size. Publisher rules such as
 * `p { font-size: small }` do not inherit that value, so they otherwise ignore
 * the reader setting. Snapshot the publisher's computed type scale at the
 * default size and apply the requested multiplier to every descendant.
 */
export function makeEpubFontSize(rendition: Rendition, initialPoints: number) {
  const documents = new Map<Document, SizedDocument>();
  let points = initialPoints;

  const size = (contents: Contents): void => {
    const { body } = contents.document;
    if (!body) return;

    let sizedDocument = documents.get(contents.document);
    if (!sizedDocument) {
      body.style.setProperty("font-size", `${initialPoints}pt`, "important");
      const elements = [body, ...body.querySelectorAll<HTMLElement>("*")].map((element) => {
        const fontSize = contents.window.getComputedStyle(element).fontSize;
        return {
          element,
          baselinePixels: Number(fontSize.endsWith("px") ? fontSize.slice(0, -2) : fontSize),
        };
      });
      sizedDocument = { contents, elements };
      documents.set(contents.document, sizedDocument);
    }
    const { elements } = sizedDocument;

    const multiplier = points / initialPoints;
    for (const { element, baselinePixels } of elements) {
      if (Number.isFinite(baselinePixels)) {
        element.style.setProperty("font-size", `${baselinePixels * multiplier}px`, "important");
      }
    }
  };

  rendition.hooks.content.register(size);

  return {
    set(nextPoints: number): void {
      points = nextPoints;
      for (const { contents } of documents.values()) size(contents);
    },
    destroy(): void {
      rendition.hooks.content.deregister(size);
      documents.clear();
    },
  };
}
