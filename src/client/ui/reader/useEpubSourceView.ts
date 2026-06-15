import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSwipeable } from "react-swipeable";
import ePub, { type Book, type Contents, type Rendition } from "epubjs";
import {
  epubAnchor,
  expandToWordBoundaries,
  popupPoint,
  type HighlightAnchor,
  type SourceReader,
} from "../../notes/highlights.ts";
import type Navigation from "epubjs/types/navigation";
import { makeEpubReader } from "./epubReader.ts";
import { useReaderSearch } from "./useReaderSearch.ts";
import type { OnSelect, SourceLocation, SourceView } from "./sourceView.ts";

function firstChapterHref(nav: Navigation): string | undefined {
  return nav.landmark?.("bodymatter")?.href ?? nav.toc?.[0]?.href;
}

// Where the reader currently sits, before it is turned into a press count.
interface RawLocation {
  index: number;
  page: number;
  atStart: boolean;
  atEnd: boolean;
}

// The book measured as arrow-key presses to the end. `offsetByIndex` maps a
// spine index to the number of presses that precede that section.
interface Pagination {
  total: number;
  divisor: number;
  offsetByIndex: Map<number, number>;
}

// Count the page-turns (arrow presses) for the whole book at a given viewport
// and zoom, by laying every section out in a hidden, throwaway rendition over
// the *same* already-parsed book and reading the real per-section page count.
// One press advances by `layout.delta`; with a 2-up spread `divisor` is 2.
async function measurePagination(
  book: Book,
  width: number,
  height: number,
  fontSizePct: number,
  isCancelled: () => boolean,
): Promise<Pagination | null> {
  if (width <= 0 || height <= 0) return null;

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:absolute;left:-99999px;top:0;width:${width}px;height:${height}px;visibility:hidden;pointer-events:none;`;
  document.body.appendChild(host);

  const probe = book.renderTo(host, { width, height, spread: "auto", flow: "paginated" });
  probe.themes.fontSize(`${fontSizePct}%`);
  try {
    const items = (
      book.spine as unknown as { spineItems: { index: number; href: string; linear?: string }[] }
    ).spineItems;

    const offsetByIndex = new Map<number, number>();
    let total = 0;
    let divisor = 1;
    for (const item of items) {
      if (isCancelled()) return null;
      offsetByIndex.set(item.index, total);
      if (item.linear === "no") continue;
      await probe.display(item.href);
      if (isCancelled()) return null;
      const loc = probe.currentLocation() as unknown as
        | { start?: { displayed?: { total?: number } } }
        | undefined;
      const props = (
        probe as unknown as { manager?: { layout?: { props?: { divisor?: number } } } }
      ).manager?.layout?.props;
      if (props?.divisor) divisor = props.divisor;
      const pages = loc?.start?.displayed?.total ?? 1;
      total += Math.max(1, Math.ceil(pages / divisor));
    }
    return { total, divisor, offsetByIndex };
  } finally {
    probe.destroy();
    host.remove();
  }
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
  const [raw, setRaw] = useState<RawLocation | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [viewportTick, setViewportTick] = useState(0);
  const measureSeqRef = useRef(0);

  const publish = (view: Option.Option<LiveView>) => {
    Effect.runSync(Ref.set(viewRef.current, view));
    setReady(Option.isSome(view));
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!file || !el) return;

    publish(Option.none());
    setRaw(null);
    setPagination(null);
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
            start?: { index: number; displayed?: { page: number } };
            atStart?: boolean;
            atEnd?: boolean;
          }
        | undefined;
      const start = loc?.start;
      if (!start?.displayed) return;
      setRaw({
        index: start.index,
        page: start.displayed.page,
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
          setViewportTick((v) => v + 1);
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

  // Recompute the page-turn total whenever the book opens, the zoom changes, or
  // the viewport resizes. Each run is a forked fiber; a newer trigger interrupts
  // the one in flight (and the debounce coalesces bursts of resize/zoom events).
  // The previous total stays on screen until the new one lands.
  useEffect(() => {
    if (!ready) return;
    const el = containerRef.current;
    const liveView = Effect.runSync(Ref.get(viewRef.current));
    if (!el || Option.isNone(liveView)) return;
    const { book } = liveView.value;
    const width = el.clientWidth;
    const height = el.clientHeight;
    const pct = fontSize;

    const seq = ++measureSeqRef.current;
    const fiber = Effect.runFork(
      Effect.gen(function* () {
        yield* Effect.sleep("250 millis");
        if (seq !== measureSeqRef.current) return;
        const result = yield* Effect.tryPromise(() =>
          measurePagination(book, width, height, pct, () => seq !== measureSeqRef.current),
        );
        if (result && seq === measureSeqRef.current) {
          yield* Effect.sync(() => setPagination(result));
        }
      }).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => console.error("failed to paginate epub", error)),
        ),
        Effect.ignore,
      ),
    );

    return () => {
      measureSeqRef.current++;
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [ready, fontSize, viewportTick]);

  const onView = useCallback((f: (view: LiveView) => void) => {
    const view = Effect.runSync(Ref.get(viewRef.current));
    if (Option.isSome(view)) f(view.value);
  }, []);
  const currentView = useCallback(
    () => Option.getOrNull(Effect.runSync(Ref.get(viewRef.current))),
    [],
  );

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
    async (anchor: HighlightAnchor): Promise<void> => {
      if (anchor.kind !== "epub-cfi") return;
      const view = currentView();
      if (view) await view.rendition.display(anchor.value);
    },
    [currentView],
  );
  const flashHighlight = useCallback(() => {
    const view = currentView();
    if (!view) return;
    const contents = view.rendition.getContents() as unknown as Contents[];
    const flashed: Element[] = [];
    for (const content of contents) {
      for (const el of content.document.querySelectorAll(".bc-highlight")) {
        el.classList.remove("bc-highlight-jump-flash");
        flashed.push(el);
      }
    }
    requestAnimationFrame(() => {
      for (const el of flashed) {
        el.classList.add("bc-highlight-jump-flash");
        el.addEventListener("animationend", () => el.classList.remove("bc-highlight-jump-flash"), {
          once: true,
        });
      }
    });
  }, [currentView]);
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

  const reader = useMemo<SourceReader>(
    () =>
      makeEpubReader(
        () => Option.getOrNull(Effect.runSync(Ref.get(viewRef.current)))?.book ?? null,
      ),
    [],
  );

  const search = useReaderSearch({
    reader,
    ready,
    goTo,
    drawSearchHighlight,
    eraseSearchHighlight,
    onSearchHighlightCleared,
  });
  openSearchRef.current = search.openSearch;

  // Turn the raw position into a press count. Until pagination lands, `total` is
  // 0 so the reader hides the count, but `atStart`/`atEnd` stay live for the
  // page-turn controls.
  const location = useMemo<SourceLocation | null>(() => {
    if (!raw) return null;
    if (!pagination || pagination.total <= 0) {
      return { page: 0, total: 0, percentage: 0, atStart: raw.atStart, atEnd: raw.atEnd };
    }
    const before = pagination.offsetByIndex.get(raw.index) ?? 0;
    const within = Math.max(1, Math.ceil(raw.page / pagination.divisor));
    const index = Math.min(pagination.total, before + within);
    return {
      page: index,
      total: pagination.total,
      percentage: index / pagination.total,
      atStart: raw.atStart,
      atEnd: raw.atEnd,
    };
  }, [raw, pagination]);

  return {
    containerRef,
    ready,
    title,
    fontSize,
    setFontSize,
    next,
    prev,
    goTo,
    flashHighlight,
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
