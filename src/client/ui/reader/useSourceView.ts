import * as Effect from "effect/Effect";
import { useCallback, useEffect, useRef, useState } from "react";
import ePub, { type Book, type Rendition, type Contents } from "epubjs";
import type Section from "epubjs/types/section";
import type { SourceReader } from "../../highlights/locateHighlight.ts";

// The epub.js binding layer. a SourceView is the live, on-screen view of a
// Source (epub.js calls these Book + Rendition; that vocabulary stays here).
// Trivial sync view pokes are plain methods; the failure-prone async work is
// Exposed as a SourceReader of Effects for the highlights domain.
export interface SourceView {
  containerRef: React.RefObject<HTMLDivElement | null>;
  ready: boolean;
  fontSize: number;
  setFontSize: (pct: number) => void;
  next: () => void;
  prev: () => void;
  goTo: (cfi: string) => void;
  drawHighlight: (id: string, cfi: string, onClick: () => void) => void;
  reader: SourceReader;
}

export function useSourceView(
  file: File | null,
  onSelect: (cfi: string, range: Range) => void,
): SourceView {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const [ready, setReady] = useState(false);
  const [fontSize, setFontSizeState] = useState(100);

  useEffect(() => {
    const el = containerRef.current;
    if (!file || !el) return;

    let cancelled = false;
    setReady(false);

    const book = ePub();
    const rendition = book.renderTo(el, { width: "100%", height: "100%" });
    bookRef.current = book;
    renditionRef.current = rendition;

    rendition.on("selected", (cfiRange: string, contents: Contents) => {
      const range = contents.range(cfiRange);
      if (range) onSelectRef.current(cfiRange, range);
      contents.window.getSelection()?.removeAllRanges();
    });

    file.arrayBuffer().then((buf) => {
      if (cancelled) return;
      book.open(buf);
      rendition.display();
      book.ready.then(() => !cancelled && setReady(true));
    });

    return () => {
      cancelled = true;
      rendition.destroy();
      book.destroy();
      bookRef.current = null;
      renditionRef.current = null;
    };
  }, [file]);

  const setFontSize = useCallback((pct: number) => {
    setFontSizeState(pct);
    renditionRef.current?.themes.fontSize(`${pct}%`);
  }, []);

  const next = useCallback(() => void renditionRef.current?.next(), []);
  const prev = useCallback(() => void renditionRef.current?.prev(), []);
  const goTo = useCallback((cfi: string) => void renditionRef.current?.display(cfi), []);
  const drawHighlight = useCallback((id: string, cfi: string, onClick: () => void) => {
    renditionRef.current?.annotations.highlight(cfi, { id }, () => onClick(), "bc-highlight");
  }, []);

  const reader: SourceReader = {
    resolveCfi: (cfi) =>
      Effect.promise(async () => {
        try {
          return (await bookRef.current?.getRange(cfi)) ?? null;
        } catch {
          return null;
        }
      }),
    findInSections: (pick) =>
      Effect.gen(function* () {
        const book = bookRef.current;
        if (!book) return null;
        yield* Effect.promise(() => book.ready);
        const items = (book.spine as unknown as { spineItems: { index: number }[] }).spineItems;
        for (const { index } of items) {
          const result = yield* Effect.acquireUseRelease(
            Effect.promise(async () => {
              const section: Section = book.spine.get(index);
              const document = await section.load(book.load.bind(book));
              return { section, document };
            }),
            ({ section, document }) =>
              Effect.sync(() =>
                pick({ document, cfiFromRange: (r) => section.cfiFromRange(r) ?? null }),
              ),
            ({ section }) => Effect.sync(() => section.unload()),
          );
          if (result) return result;
        }
        return null;
      }),
  };

  return { containerRef, ready, fontSize, setFontSize, next, prev, goTo, drawHighlight, reader };
}
