import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { useCallback, useEffect, useRef, useState } from "react";
import ePub, { type Book, type Contents, type Rendition } from "epubjs";
import type Section from "epubjs/types/section";
import { expandToWordBoundaries, type SourceReader } from "../../highlights.ts";
import type Navigation from "epubjs/types/navigation";

function firstChapterHref(nav: Navigation): string | undefined {
  return nav.landmark?.("bodymatter")?.href ?? nav.toc?.[0]?.href;
}

// Epub.js binding layer.
interface LiveView {
  book: Book;
  rendition: Rendition;
}

// A rendered epub.js view exposes its highlight pane for re-rendering.
interface ResizableView {
  on: (e: string, cb: () => void) => void;
  pane?: { render: () => void };
}

export interface SourceView {
  containerRef: React.RefObject<HTMLDivElement | null>;
  ready: boolean;
  // The epub's parsed metadata title, once loaded (null until then / if absent).
  title: string | null;
  fontSize: number;
  setFontSize: (pct: number) => void;
  next: () => void;
  prev: () => void;
  goTo: (cfi: string) => void;
  drawHighlight: (id: string, cfi: string, onClick: () => void) => void;
  eraseHighlight: (cfi: string) => void;
  // A live text selection awaiting confirmation, anchored at viewport coords.
  selection: { x: number; y: number } | null;
  commitSelection: () => void;
  dismissSelection: () => void;
  location: {
    page: number;
    total: number;
    percentage: number;
    atStart: boolean;
    atEnd: boolean;
  } | null;
  reader: SourceReader;
}

export function useSourceView(
  file: File | null,
  onSelect: (cfi: string, range: Range) => void,
): SourceView {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [title, setTitle] = useState<string | null>(null);

  // Single source of truth: a usable rendition exists iff the reader is ready.
  const viewRef = useRef(Effect.runSync(Ref.make(Option.none<LiveView>())));
  const [ready, setReady] = useState(false);
  const [fontSize, setFontSizeState] = useState(100);
  // Pending selection: popup position is state; range/cfi and the native-selection clearer live in a ref.
  const [selection, setSelection] = useState<{ x: number; y: number } | null>(null);
  const pendingRef = useRef<{ cfi: string; range: Range; clear: () => void } | null>(null);
  // Page within the current spine item, plus overall percentage from synthetic locations.
  const [location, setLocation] = useState<{
    page: number;
    total: number;
    percentage: number;
    atStart: boolean;
    atEnd: boolean;
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
    setTitle(null);

    const book = ePub();
    // `spread: "auto"` gives a two-page spread on a wide pane, like a real book.
    const rendition = book.renderTo(el, { width: "100%", height: "100%", spread: "auto" });

    // When a view resizes, re-render its highlight pane on the next frame.
    rendition.on("rendered", (_section: unknown, view: ResizableView) => {
      view.on("resized", () => requestAnimationFrame(() => view.pane?.render()));
    });

    // Don't commit on selection; snap to word boundaries and surface an
    // "Add Note" button. The highlight is created only when it's pressed.
    rendition.on("selected", (cfiRange: string, contents: Contents) => {
      const raw = contents.range(cfiRange);
      if (!raw || raw.collapsed) return;
      const range = expandToWordBoundaries(raw);
      const cfi = contents.cfiFromRange(range);
      const rect = range.getBoundingClientRect();
      const frame = contents.window.frameElement?.getBoundingClientRect();
      pendingRef.current = {
        cfi,
        range,
        clear: () => contents.window.getSelection()?.removeAllRanges(),
      };
      setSelection({
        x: (frame?.left ?? 0) + rect.left + rect.width / 2,
        y: (frame?.top ?? 0) + rect.bottom,
      });
    });

    const showLocation = () => {
      const loc = rendition.currentLocation() as unknown as
        | {
            start?: { cfi: string; displayed?: { page: number; total: number } };
            atStart?: boolean;
            atEnd?: boolean;
          }
        | undefined;
      const start = loc?.start;
      if (!start?.displayed) return;
      const generated = book.locations.length();
      const percentage = generated ? book.locations.percentageFromCfi(start.cfi) : 0;
      setLocation({
        page: start.displayed.page,
        total: start.displayed.total,
        percentage,
        atStart: loc?.atStart ?? false,
        atEnd: loc?.atEnd ?? false,
      });
    };

    rendition.on("relocated", () => {
      showLocation();
      pendingRef.current = null;
      setSelection(null);
    });

    // The split divider resizes the pane without a window resize; reflow
    // ourselves, throttled to one reflow per frame to track the drag live.
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
      // Surface the epub's metadata title (used as the default book label).
      const metadata = yield* Effect.tryPromise(() => book.loaded.metadata).pipe(
        Effect.orElseSucceed(() => null),
      );
      yield* Effect.sync(() => setTitle(metadata?.title?.trim() || null));
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
      Effect.tapError((error) => Effect.sync(() => console.error("failed to open epub", error))),
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
  const next = useCallback(() => onView((v) => void v.rendition.next()), [onView]);
  const prev = useCallback(() => onView((v) => void v.rendition.prev()), [onView]);
  const goTo = useCallback((cfi: string) => onView((v) => void v.rendition.display(cfi)), [onView]);
  const drawHighlight = useCallback(
    (id: string, cfi: string, onClick: () => void) =>
      onView((v) =>
        v.rendition.annotations.highlight(cfi, { id }, () => onClick(), "bc-highlight"),
      ),
    [onView],
  );
  const eraseHighlight = useCallback(
    (cfi: string) => onView((v) => v.rendition.annotations.remove(cfi, "highlight")),
    [onView],
  );

  const dismissSelection = useCallback(() => {
    pendingRef.current?.clear();
    pendingRef.current = null;
    setSelection(null);
  }, []);
  const commitSelection = useCallback(() => {
    const pending = pendingRef.current;
    if (pending) onSelectRef.current(pending.cfi, pending.range);
    dismissSelection();
  }, [dismissSelection]);

  // Run an effect against the live book, or yield `fallback` if not ready.
  const withBook = <A>(fallback: A, f: (book: Book) => Effect.Effect<A>): Effect.Effect<A> =>
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
      ),
  };

  return {
    containerRef,
    ready,
    title,
    fontSize,
    setFontSize,
    next,
    prev,
    goTo,
    drawHighlight,
    eraseHighlight,
    selection,
    commitSelection,
    dismissSelection,
    location,
    reader,
  };
}
