import type { Contents } from "epubjs";

interface SizedElement {
  readonly element: HTMLElement;
  readonly baselinePixels: number;
}

export type ChapterContents = Pick<Contents, "document" | "window">;

/** The part of an epub.js Rendition that font sizing reads. */
export interface ChapterHost {
  readonly hooks: {
    readonly content: {
      register(hook: (contents: ChapterContents) => void): void;
      deregister(hook: (contents: ChapterContents) => void): void;
    };
  };
  getContents(): unknown;
}

/**
 * epub.js changes only the body font size. Publisher rules such as
 * `p { font-size: small }` do not inherit that value, so they otherwise ignore
 * the reader setting. Snapshot the publisher's computed type scale at the
 * default size and apply the requested multiplier to every descendant.
 */
export function makeEpubFontSize(rendition: ChapterHost, initialPoints: number) {
  // Keyed weakly: epub.js discards a chapter's document when the reader moves
  // on, and the snapshot must not keep it alive.
  const baselines = new WeakMap<Document, SizedElement[]>();
  let points = initialPoints;

  const size = (contents: ChapterContents): void => {
    const { body } = contents.document;
    if (!body) return;

    let elements = baselines.get(contents.document);
    if (!elements) {
      body.style.setProperty("font-size", `${initialPoints}pt`, "important");
      elements = [body, ...body.querySelectorAll<HTMLElement>("*")].map((element) => {
        const fontSize = contents.window.getComputedStyle(element).fontSize;
        return {
          element,
          baselinePixels: Number(fontSize.endsWith("px") ? fontSize.slice(0, -2) : fontSize),
        };
      });
      baselines.set(contents.document, elements);
    }

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
      // Only the documents epub.js still displays; the others are detached.
      const contents = rendition.getContents();
      // SAFETY: epub.js getContents returns its Contents instances despite the incomplete declaration.
      for (const content of contents as ChapterContents[]) size(content);
    },
    destroy(): void {
      rendition.hooks.content.deregister(size);
    },
  };
}
