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

interface LiveView {
  book: Book;
  rendition: Rendition;
}

interface ResizableView {
  on: (e: string, cb: () => void) => void;
  pane?: { render: () => void };
  contents?: Contents;
}

interface SectionHandle {
  document: Document;
  cfiFromRange(range: Range): string | null;
}

export function useEpubSourceView(
  file: File | null,
  onSelect: OnSelect,
  onSwipe?: (dir: "left" | "right") => void,
  onSearchHighlightCleared?: () => void,
): SourceView {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;
  const openSearchRef = useRef<() => void>(() => {});
  const [title, setTitle] = useState<string | null>(null);

  const swipe = useSwipeable({
    onSwipedLeft: () => onSwipeRef.current?.("left"),
    onSwipedRight: () => onSwipeRef.current?.("right"),
    delta: 60,
  });
  const swipeRef = useRef(swipe.ref);
  swipeRef.current = swipe.ref;

  const viewRef = useRef(Effect.runSync(Ref.make(Option.none<LiveView>())));
  const [ready, setReady] = useState(false);
  const [fontSize, setFontSizeState] = useState(100);
  const [selection, setSelection] = useState<{ x: number; y: number } | null>(null);
  const pendingRef = useRef<{ cfi: string; range: Range; clear: () => void } | null>(null);
  const drawnCfiRef = useRef<Map<string, string>>(new Map());
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
    const rendition = book.renderTo(el, { width: "100%", height: "100%", spread: "auto" });

    rendition.themes.default({ body: { "-webkit-user-select": "text", "user-select": "text" } });

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

    const poll = window.setInterval(() => {
      const views = rendition.getContents() as unknown as Contents[];
      const active = views.find((c) => {
        const s = c.window.getSelection();
        return s !== null && !s.isCollapsed && s.toString().trim() !== "";
      });
      if (active) onSelection(active);
      else clearSelection();
    }, 300);

    const removeContentKeydowns: (() => void)[] = [];
    rendition.on("rendered", (_section: unknown, view: ResizableView) => {
      view.on("resized", () => requestAnimationFrame(() => view.pane?.render()));
      if (view.contents) {
        swipeRef.current(view.contents.document.body);
        const onKeyDown = (event: KeyboardEvent) => {
          if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f") return;
          event.preventDefault();
          openSearchRef.current();
        };
        view.contents.document.addEventListener("keydown", onKeyDown);
        removeContentKeydowns.push(() =>
          view.contents?.document.removeEventListener("keydown", onKeyDown),
        );
      }
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
      const rawLocation = generated ? Number(book.locations.locationFromCfi(start.cfi)) : 0;
      const page = generated
        ? Math.min(generated, Math.max(1, rawLocation + 1))
        : start.displayed.page;
      const total = generated || start.displayed.total;
      const percentage = generated ? (book.locations.percentageFromCfi(start.cfi) ?? 0) : 0;
      setLocation({
        page,
        total,
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
      const metadata = yield* Effect.tryPromise(() => book.loaded.metadata).pipe(
        Effect.orElseSucceed(() => null),
      );
      yield* Effect.sync(() => setTitle(metadata?.title?.trim() || null));
      const start = yield* Effect.tryPromise(() => book.loaded.navigation).pipe(
        Effect.map(firstChapterHref),
        // oxlint-disable-next-line no-useless-undefined
        Effect.orElseSucceed(() => undefined),
      );
      yield* Effect.tryPromise(() => rendition.display(start));
      yield* Effect.sync(() => publish(Option.some({ book, rendition })));
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
      for (const removeContentKeydown of removeContentKeydowns) removeContentKeydown();
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
  const drawSearchHighlight = useCallback(
    (anchor: HighlightAnchor) => {
      if (anchor.kind !== "epub-cfi") return;
      onView((v) => {
        if ([...drawnCfiRef.current.values()].includes(anchor.value)) {
          v.rendition.annotations.remove(anchor.value, "highlight");
        }
        v.rendition.annotations.highlight(anchor.value, {}, () => {}, "bc-search");
      });
    },
    [onView],
  );
  const eraseSearchHighlight = useCallback(
    (anchor: HighlightAnchor) => {
      if (anchor.kind !== "epub-cfi") return;
      onView((v) => v.rendition.annotations.remove(anchor.value, "highlight"));
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

  const reader = useMemo<SourceReader>(() => {
    const withBook = <A>(fallback: A, f: (book: Book) => Effect.Effect<A>): Effect.Effect<A> =>
      Effect.flatMap(Ref.get(viewRef.current), (view) =>
        Option.isSome(view) ? f(view.value.book) : Effect.succeed(fallback),
      );
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

  const search = useReaderSearch({
    reader,
    ready,
    goTo,
    drawSearchHighlight,
    eraseSearchHighlight,
    onSearchHighlightCleared,
  });
  openSearchRef.current = search.openSearch;

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
