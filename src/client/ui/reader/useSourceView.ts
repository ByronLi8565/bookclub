import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { useCallback, useEffect, useRef, useState } from "react";
import ePub, { type Book, type Contents, type Rendition } from "epubjs";
import type Section from "epubjs/types/section";
import type { SourceReader } from "../../highlights/locateHighlight.ts";
import type Navigation from "epubjs/types/navigation";

function firstChapterHref(nav: Navigation): string | undefined {
  return nav.landmark?.("bodymatter")?.href ?? nav.toc?.[0]?.href;
}

// Epub.js binding layer.
interface LiveView {
  book: Book;
  rendition: Rendition;
}

export interface SourceView {
  containerRef: React.RefObject<HTMLDivElement | null>;
  ready: boolean;
  fontSize: number;
  setFontSize: (pct: number) => void;
  next: () => void;
  prev: () => void;
  goTo: (cfi: string) => void;
  drawHighlight: (id: string, cfi: string, onClick: () => void) => void;
  location: { page: number; total: number; percentage: number } | null;
  reader: SourceReader;
}

export function useSourceView(
  file: File | null,
  onSelect: (cfi: string, range: Range) => void,
): SourceView {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Single source of truth: a usable rendition exists iff the reader is ready.
  const viewRef = useRef(Effect.runSync(Ref.make(Option.none<LiveView>())));
  const [ready, setReady] = useState(false);
  const [fontSize, setFontSizeState] = useState(100);
  // Rendition pagination: page within the current spine item (viewport-dependent),
  // plus an overall percentage derived from synthetic locations.
  const [location, setLocation] = useState<{
    page: number;
    total: number;
    percentage: number;
  } | null>(null);

  const publish = (view: Option.Option<LiveView>) => {
    Effect.runSync(Ref.set(viewRef.current, view));
    setReady(Option.isSome(view));
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!file || !el) return;

    publish(Option.none());
    setLocation(null);

    const book = ePub();
    // `spread: "auto"` gives a two-page spread on a wide pane (single on narrow),
    // replicating a physical book.
    const rendition = book.renderTo(el, {
      width: "100%",
      height: "100%",
      spread: "auto",
    });

    // When a view resizes, re-render its highlight pane on the next frame.
    rendition.on(
      "rendered",
      (
        _section: unknown,
        view: {
          on: (e: string, cb: () => void) => void;
          pane?: { render: () => void };
        },
      ) => {
        view.on("resized", () =>
          requestAnimationFrame(() => view.pane?.render()),
        );
      },
    );

    rendition.on("selected", (cfiRange: string, contents: Contents) => {
      const range = contents.range(cfiRange);
      if (range) onSelectRef.current(cfiRange, range);
      contents.window.getSelection()?.removeAllRanges();
    });

    const showLocation = () => {
      const loc = rendition.currentLocation() as unknown as
        | {
            start?: {
              cfi: string;
              displayed?: { page: number; total: number };
            };
          }
        | undefined;
      const start = loc?.start;
      if (!start?.displayed) return;
      const generated = book.locations.length();
      const percentage = generated
        ? book.locations.percentageFromCfi(start.cfi)
        : 0;
      setLocation({
        page: start.displayed.page,
        total: start.displayed.total,
        percentage,
      });
    };

    rendition.on("relocated", () => showLocation());

    // The pane is resizable (split divider), which doesn't fire a window resize,
    // so reflow the rendition ourselves. Throttled to one reflow per animation
    // frame so it tracks the drag live without firing twice in a frame.
    let resizeFrame: number | undefined;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrame !== undefined) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = undefined;
        if (Option.isNone(Effect.runSync(Ref.get(viewRef.current)))) return;
        try {
          rendition.resize(el.clientWidth, el.clientHeight);
          showLocation();
        } catch (error) {
          console.error("failed to resize rendition", error);
        }
      });
    });
    resizeObserver.observe(el);

    const load = Effect.gen(function* () {
      const buf = yield* Effect.tryPromise(() => file.arrayBuffer());
      yield* Effect.tryPromise(() => book.open(buf, "binary"));
      // Start on the first real chapter
      const start = yield* Effect.tryPromise(() => book.loaded.navigation).pipe(
        Effect.map(firstChapterHref),
        // oxlint-disable-next-line no-useless-undefined
        Effect.orElseSucceed(() => undefined),
      );
      yield* Effect.tryPromise(() => rendition.display(start));
      yield* Effect.sync(() => publish(Option.some({ book, rendition })));
      // Generate synthetic locations after display; the overall percentage appears once ready.
      yield* Effect.tryPromise(() => book.locations.generate(1024));
      yield* Effect.sync(showLocation);
    }).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => console.error("failed to open epub", error)),
      ),
      Effect.ignore,
    );

    const fiber = Effect.runFork(load);

    return () => {
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      Effect.runFork(Fiber.interrupt(fiber));
      publish(Option.none());
      rendition.destroy();
      book.destroy();
    };
  }, [file]);

  const onView = useCallback((f: (view: LiveView) => void) => {
    const view = Effect.runSync(Ref.get(viewRef.current));
    if (Option.isSome(view)) f(view.value);
  }, []);

  const setFontSize = useCallback(
    (pct: number) => {
      setFontSizeState(pct);
      onView((v) => v.rendition.themes.fontSize(`${pct}%`));
    },
    [onView],
  );
  const next = useCallback(
    () => onView((v) => void v.rendition.next()),
    [onView],
  );
  const prev = useCallback(
    () => onView((v) => void v.rendition.prev()),
    [onView],
  );
  const goTo = useCallback(
    (cfi: string) => onView((v) => void v.rendition.display(cfi)),
    [onView],
  );
  const drawHighlight = useCallback(
    (id: string, cfi: string, onClick: () => void) =>
      onView((v) =>
        v.rendition.annotations.highlight(
          cfi,
          { id },
          () => onClick(),
          "bc-highlight",
        ),
      ),
    [onView],
  );

  // Run an effect against the live book, or yield `fallback` if not ready.
  const withBook = <A>(
    fallback: A,
    f: (book: Book) => Effect.Effect<A>,
  ): Effect.Effect<A> =>
    Effect.flatMap(Ref.get(viewRef.current), (view) =>
      Option.isSome(view) ? f(view.value.book) : Effect.succeed(fallback),
    );

  const reader: SourceReader = {
    resolveCfi: (cfi) =>
      withBook(null, (book) =>
        Effect.tryPromise(() => book.getRange(cfi)).pipe(
          Effect.map((range) => range ?? null),
          Effect.orElseSucceed(() => null),
        ),
      ),
    findInSections: (pick) =>
      withBook(null, (book) =>
        Effect.gen(function* () {
          const items = (
            book.spine as unknown as { spineItems: { index: number }[] }
          ).spineItems;
          for (const { index } of items) {
            const result = yield* Effect.acquireUseRelease(
              Effect.promise(async () => {
                const section: Section = book.spine.get(index);
                const document = await section.load(book.load.bind(book));
                return { section, document };
              }),
              ({ section, document }) =>
                Effect.sync(() =>
                  pick({
                    document,
                    cfiFromRange: (r) => section.cfiFromRange(r) ?? null,
                  }),
                ),
              ({ section }) => Effect.sync(() => section.unload()),
            );
            if (result) return result;
          }
          return null;
        }),
      ),
  };

  return {
    containerRef,
    ready,
    fontSize,
    setFontSize,
    next,
    prev,
    goTo,
    drawHighlight,
    location,
    reader,
  };
}
