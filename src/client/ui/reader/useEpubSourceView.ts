import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSwipeable } from "react-swipeable";
import ePub, { type Book, type Contents, type Rendition } from "epubjs";
import type Section from "epubjs/types/section";
import {
  epubAnchor,
  expandToWordBoundaries,
  findAllRanges,
  popupPoint,
  searchQuote,
  type HighlightAnchor,
  type SearchMatch,
  type SourceReader,
} from "../../notes/highlights.ts";
import type Navigation from "epubjs/types/navigation";
import { useReaderSearch } from "./useReaderSearch.ts";
import type { OnSelect, SourceView } from "./sourceView.ts";

function firstChapterHref(nav: Navigation): string | undefined {
  return nav.landmark?.("bodymatter")?.href ?? nav.toc?.[0]?.href;
}

// Epub.js binding layer.
interface LiveView {
  book: Book;
  rendition: Rendition;
}

// A rendered epub.js view: its highlight pane (re-render) and Contents (selection).
interface ResizableView {
  on: (e: string, cb: () => void) => void;
  pane?: { render: () => void };
  contents?: Contents;
}

// One loaded spine item, presented to the rebind/search scan.
interface SectionHandle {
  document: Document;
  cfiFromRange(range: Range): string | null;
}

// The EPUB source adapter: an epub.js rendition behind the format-agnostic
// SourceView. Anchors are EPUB CFIs; the adapter maps highlight ids to the cfi
// they were painted at so the reader can erase by id.
export function useEpubSourceView(
  file: File | null,
  onSelect: OnSelect,
  onSwipe?: (dir: "left" | "right") => void,
): SourceView {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;
  const [title, setTitle] = useState<string | null>(null);

  // Detect horizontal swipes inside the epub iframe by attaching react-swipeable
  // to the iframe body (it can't bubble to our React tree). The ref is stashed so
  // the per-view `rendered` handler can attach it to each spine iframe.
  const swipe = useSwipeable({
    onSwipedLeft: () => onSwipeRef.current?.("left"),
    onSwipedRight: () => onSwipeRef.current?.("right"),
    delta: 60,
  });
  const swipeRef = useRef(swipe.ref);
  swipeRef.current = swipe.ref;

  // Single source of truth: a usable rendition exists iff the reader is ready.
  const viewRef = useRef(Effect.runSync(Ref.make(Option.none<LiveView>())));
  const [ready, setReady] = useState(false);
  const [fontSize, setFontSizeState] = useState(100);
  // Pending selection: popup position is state; range/cfi and the native-selection clearer live in a ref.
  const [selection, setSelection] = useState<{ x: number; y: number } | null>(null);
  const pendingRef = useRef<{ cfi: string; range: Range; clear: () => void } | null>(null);
  // Highlight id -> the cfi it was painted at, so the reader can erase by id.
  const drawnCfiRef = useRef<Map<string, string>>(new Map());
  // Page within the current spine item, plus overall percentage from synthetic locations.
  const [location, setLocation] = useState<SourceView["location"]>(null);

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
    drawnCfiRef.current.clear();

    const book = ePub();
    // `spread: "auto"` gives a two-page spread on a wide pane, like a real book.
    const rendition = book.renderTo(el, { width: "100%", height: "100%", spread: "auto" });

    // Keep text selectable on touch (iOS long-press); our stylesheet can't reach the iframe.
    rendition.themes.default({ body: { "-webkit-user-select": "text", "user-select": "text" } });

    // Snap a live selection to word boundaries and surface the "Add Note" button.
    // `lastText` dedupes the poll below so we only re-render when it changes.
    let lastText = "";
    const onSelection = (contents: Contents) => {
      const sel = contents.window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.getRangeAt(0).collapsed) return;
      const text = sel.toString();
      if (text === lastText) return;
      lastText = text;
      const range = expandToWordBoundaries(sel.getRangeAt(0));
      const frame = contents.window.frameElement?.getBoundingClientRect();
      pendingRef.current = {
        cfi: contents.cfiFromRange(range),
        range,
        clear: () => sel.removeAllRanges(),
      };
      setSelection(popupPoint(range.getBoundingClientRect(), frame));
    };
    const clearSelection = () => {
      if (lastText === "") return;
      lastText = "";
      pendingRef.current = null;
      setSelection(null);
    };

    // iOS never fires `selectionchange` inside the (sandboxed srcdoc) epub iframe,
    // so we poll the live selection instead. The text itself is readable, just not
    // event-driven; this is the one reliable cross-platform detection path.
    const poll = window.setInterval(() => {
      const views = rendition.getContents() as unknown as Contents[];
      const active = views.find((c) => {
        const s = c.window.getSelection();
        return s !== null && !s.isCollapsed && s.toString().trim() !== "";
      });
      if (active) onSelection(active);
      else clearSelection();
    }, 300);

    rendition.on("rendered", (_section: unknown, view: ResizableView) => {
      view.on("resized", () => requestAnimationFrame(() => view.pane?.render()));
      if (view.contents) swipeRef.current(view.contents.document.body);
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
      // Surface the epub's metadata title (used as the default source label).
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
      clearInterval(poll);
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
  const goTo = useCallback(
    (anchor: HighlightAnchor) => {
      if (anchor.kind !== "epub-cfi") return;
      onView((v) => void v.rendition.display(anchor.value));
    },
    [onView],
  );
  const drawHighlight = useCallback(
    (id: string, anchor: HighlightAnchor, onClick: () => void) => {
      if (anchor.kind !== "epub-cfi") return;
      const cfi = anchor.value;
      onView((v) => {
        v.rendition.annotations.highlight(cfi, { id }, () => onClick(), "bc-highlight");
        drawnCfiRef.current.set(id, cfi);
      });
    },
    [onView],
  );
  const eraseHighlight = useCallback(
    (id: string) => {
      const cfi = drawnCfiRef.current.get(id);
      if (cfi === undefined) return;
      drawnCfiRef.current.delete(id);
      onView((v) => v.rendition.annotations.remove(cfi, "highlight"));
    },
    [onView],
  );
  // Search uses the "underline" annotation type, a separate keyspace from note
  // highlights, so painting/erasing a search match can never disturb a note's
  // highlight even at an identical cfi range.
  const drawUnderline = useCallback(
    (anchor: HighlightAnchor) => {
      if (anchor.kind !== "epub-cfi") return;
      onView((v) => v.rendition.annotations.underline(anchor.value, {}, () => {}, "bc-search"));
    },
    [onView],
  );
  const eraseUnderline = useCallback(
    (anchor: HighlightAnchor) => {
      if (anchor.kind !== "epub-cfi") return;
      onView((v) => v.rendition.annotations.remove(anchor.value, "underline"));
    },
    [onView],
  );

  const dismissSelection = useCallback(() => {
    pendingRef.current?.clear();
    pendingRef.current = null;
    setSelection(null);
  }, []);
  const commitSelection = useCallback(() => {
    const pending = pendingRef.current;
    if (pending) onSelectRef.current(epubAnchor(pending.cfi), pending.range);
    dismissSelection();
  }, [dismissSelection]);

  // The reader only closes over the stable `viewRef`, so it's built once. A
  // stable identity matters: useReaderSearch keys its effects off it.
  const reader = useMemo<SourceReader>(() => {
    // Run an effect against the live book, or yield `fallback` if not ready.
    const withBook = <A>(fallback: A, f: (book: Book) => Effect.Effect<A>): Effect.Effect<A> =>
      Effect.flatMap(Ref.get(viewRef.current), (view) =>
        Option.isSome(view) ? f(view.value.book) : Effect.succeed(fallback),
      );
    // Load every spine item in order, run `pick` against each, concatenate. A
    // spine item that fails to load (cover, nav, malformed doc) is skipped.
    const findInSections = <A>(pick: (section: SectionHandle) => A[]): Effect.Effect<A[]> =>
      withBook<A[]>([], (book) =>
        Effect.gen(function* () {
          const items = (book.spine as unknown as { spineItems: { index: number }[] }).spineItems;
          const results: A[] = [];
          for (const { index } of items) {
            const found = yield* Effect.acquireUseRelease(
              Effect.tryPromise(async () => {
                const section: Section = book.spine.get(index);
                const document = await section.load(book.load.bind(book));
                return { section, document };
              }),
              ({ section, document }) =>
                Effect.sync(() =>
                  pick({ document, cfiFromRange: (r) => section.cfiFromRange(r) ?? null }),
                ),
              ({ section }) => Effect.sync(() => section.unload()),
            ).pipe(Effect.orElseSucceed((): A[] => []));
            results.push(...found);
          }
          return results;
        }),
      );
    return {
      locateHighlight: (h) =>
        withBook<HighlightAnchor | null>(null, (book) =>
          Effect.gen(function* () {
            if (h.anchor.kind === "epub-cfi") {
              const cfi = h.anchor.value;
              const range = yield* Effect.tryPromise(() => book.getRange(cfi)).pipe(
                Effect.map((r) => r ?? null),
                Effect.orElseSucceed(() => null),
              );
              if (range) return epubAnchor(cfi);
            }
            const fresh = yield* findInSections((section) => {
              const found = searchQuote(section.document, h.quote);
              const cfi = found ? section.cfiFromRange(found) : null;
              return cfi ? [cfi] : [];
            });
            const first = fresh[0];
            return first ? epubAnchor(first) : null;
          }),
        ),
      search: (query) =>
        query.trim() === ""
          ? Effect.succeed<SearchMatch[]>([])
          : findInSections((section) =>
              findAllRanges(section.document, query).flatMap(({ range, excerpt }) => {
                const cfi = section.cfiFromRange(range);
                return cfi ? [{ anchor: epubAnchor(cfi), excerpt }] : [];
              }),
            ),
    };
  }, []);

  const search = useReaderSearch({ reader, ready, goTo, drawUnderline, eraseUnderline });

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
    search,
  };
}
