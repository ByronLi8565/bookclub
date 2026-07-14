import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useSwipeable } from "react-swipeable";
import ePub, { type Book, type Contents, type Rendition } from "epubjs";
import {
  epubAnchor,
  expandToWordBoundaries,
  popupPoint,
  type HighlightAnchor,
  type SourceReader,
} from "../../logic/notes/highlights.ts";
import type Navigation from "epubjs/types/navigation";
import { makeEpubReader } from "./engine/epubReader.ts";
import { useReaderPrefs } from "../../logic/settings/userPrefs.ts";
import { useLatestRef } from "../../logic/useLatestRef.ts";
import { useReaderSearch } from "./useReaderSearch.ts";
import type { SourceReadingPosition } from "../../../shared/types/readingPositions.ts";
import { bumpSeq } from "./engine/seq.ts";
import { type OnSelect, type SelectIntent } from "./types.ts";
import { type SourceView } from "./types.ts";
import { type SourceLocation } from "./types.ts";

function firstChapterHref(nav: Navigation): string | undefined {
  return nav.landmark?.("bodymatter")?.href ?? nav.toc?.[0]?.href;
}

// Where the reader currently sits, before it is turned into a press count.
interface RawLocation {
  index: number;
  cfi: string | null;
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
  spread: string,
  isCancelled: () => boolean,
): Promise<Pagination | null> {
  if (width <= 0 || height <= 0) return null;

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:absolute;left:-99999px;top:0;width:${width}px;height:${height}px;visibility:hidden;pointer-events:none;`;
  document.body.appendChild(host);

  const probe = book.renderTo(host, { width, height, spread, flow: "paginated" });
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

const EPUB_PANE_SWIPE_DELTA_PX = 60;
const EPUB_CHROME_SWIPE_DELTA_PX = 90;

interface ResizableView {
  on: (e: string, cb: () => void) => void;
  pane?: { render: () => void };
  contents?: Contents;
}

function afterLayout(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

interface EpubOpenedSource {
  file: File | null;
  initialEpubCfi: string | null;
}

interface EpubViewState {
  openedSource: EpubOpenedSource;
  ready: boolean;
  title: string | null;
  raw: RawLocation | null;
  pagination: Pagination | null;
  viewportTick: number;
  selection: { x: number; y: number } | null;
}

type EpubViewAction =
  | { type: "reset"; openedSource: EpubOpenedSource }
  | { type: "ready"; ready: boolean }
  | { type: "title"; title: string | null }
  | { type: "raw"; raw: RawLocation | null }
  | { type: "pagination"; pagination: Pagination | null }
  | { type: "viewport"; raw?: RawLocation }
  | { type: "selection"; selection: { x: number; y: number } | null };

function epubViewReducer(state: EpubViewState, action: EpubViewAction): EpubViewState {
  switch (action.type) {
    case "reset":
      return {
        openedSource: action.openedSource,
        ready: false,
        title: null,
        raw: null,
        pagination: null,
        viewportTick: state.viewportTick + 1,
        selection: null,
      };
    case "ready":
      return { ...state, ready: action.ready };
    case "title":
      return { ...state, title: action.title };
    case "raw":
      return { ...state, raw: action.raw };
    case "pagination":
      return { ...state, pagination: action.pagination };
    case "viewport":
      return { ...state, raw: action.raw ?? state.raw, viewportTick: state.viewportTick + 1 };
    case "selection":
      return { ...state, selection: action.selection };
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, [contenteditable="true"]') !== null
  );
}

export function useEpubSourceView(
  file: File | null,
  onSelect: OnSelect,
  onSwipe?: (dir: "left" | "right" | "up" | "down") => void,
  onSearchHighlightCleared?: () => void,
  initialPosition?: SourceReadingPosition | null,
  suspendResize = false,
): SourceView {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSelectRef = useLatestRef(onSelect);
  const onSwipeRef = useLatestRef(onSwipe);
  const suspendResizeRef = useLatestRef(suspendResize);
  // "auto" lets epub.js use a two-page spread when wide enough; "none" forces a
  // single page. Driven by the shared page-layout preference (toggled with `d`).
  const { pdfPageLayout } = useReaderPrefs();
  const spreadMode = pdfPageLayout === "auto" ? "auto" : "none";
  const spreadModeRef = useLatestRef(spreadMode);
  const openSearchRef = useRef<() => void>(() => {});
  const initialEpubCfi = initialPosition?.kind === "epub" ? initialPosition.cfi : null;

  const swipe = useSwipeable({
    onSwipedLeft: () => onSwipeRef.current?.("left"),
    onSwipedRight: () => onSwipeRef.current?.("right"),
    onSwipedUp: () => onSwipeRef.current?.("up"),
    onSwipedDown: () => onSwipeRef.current?.("down"),
    delta: {
      left: EPUB_PANE_SWIPE_DELTA_PX,
      right: EPUB_PANE_SWIPE_DELTA_PX,
      up: EPUB_CHROME_SWIPE_DELTA_PX,
      down: EPUB_CHROME_SWIPE_DELTA_PX,
    },
    preventScrollOnSwipe: true,
  });
  const swipeRef = useLatestRef(swipe.ref);

  const viewRef = useRef<LiveView | null>(null);
  const [fontSize, setFontSizeState] = useState(100);
  const pendingRef = useRef<{ cfi: string; range: Range; clear: () => void } | null>(null);
  const drawnCfiRef = useRef<Map<string, { cfi: string; onClick: () => void }>>(null!);
  drawnCfiRef.current ??= new Map<string, { cfi: string; onClick: () => void }>();
  const measureSeqRef = useRef(0);
  const [viewState, dispatchView] = useReducer(epubViewReducer, {
    openedSource: { file, initialEpubCfi },
    ready: false,
    title: null,
    raw: null,
    pagination: null,
    viewportTick: 0,
    selection: null,
  });
  const { ready, title, raw, pagination, viewportTick, selection } = viewState;
  const { openedSource } = viewState;

  if (openedSource.file !== file || openedSource.initialEpubCfi !== initialEpubCfi) {
    dispatchView({ type: "reset", openedSource: { file, initialEpubCfi } });
    drawnCfiRef.current.clear();
  }

  const publish = (view: LiveView | null) => {
    viewRef.current = view;
    dispatchView({ type: "ready", ready: view !== null });
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!file || !el) return;

    const book = ePub();
    const rendition = book.renderTo(el, {
      width: "100%",
      height: "100%",
      spread: spreadModeRef.current,
    });

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
      dispatchView({
        type: "selection",
        selection: popupPoint(range.getBoundingClientRect(), frame),
      });
    };
    const clearSelection = () => {
      if (lastText === "") return;
      lastText = "";
      pendingRef.current = null;
      dispatchView({ type: "selection", selection: null });
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
        const doc = view.contents.document;
        doc.documentElement.style.touchAction = "none";
        doc.body.style.touchAction = "none";
        swipeRef.current(doc.body);
        const onKeyDown = (event: KeyboardEvent) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
            event.preventDefault();
            openSearchRef.current();
            return;
          }
          if (event.altKey || event.metaKey || event.ctrlKey || isEditableTarget(event.target))
            return;
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            void rendition.prev();
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            void rendition.next();
          }
        };
        doc.addEventListener("keydown", onKeyDown);
        removeContentKeydowns.push(() => doc.removeEventListener("keydown", onKeyDown));
      }
    });

    const showLocation = () => {
      const loc = rendition.currentLocation() as unknown as
        | {
            start?: { index: number; cfi?: string; displayed?: { page: number } };
            atStart?: boolean;
            atEnd?: boolean;
          }
        | undefined;
      const start = loc?.start;
      if (!start?.displayed) return;
      dispatchView({
        type: "raw",
        raw: {
          index: start.index,
          cfi: start.cfi ?? null,
          page: start.displayed.page,
          atStart: loc?.atStart ?? false,
          atEnd: loc?.atEnd ?? false,
        },
      });
    };

    rendition.on("relocated", () => {
      showLocation();
      pendingRef.current = null;
      dispatchView({ type: "selection", selection: null });
    });

    const load = Effect.fn("EpubReader.open")(function* () {
      const buf = yield* Effect.tryPromise(() => file.arrayBuffer());
      yield* Effect.tryPromise(() => book.open(buf, "binary"));
      const metadata = yield* Effect.tryPromise(() => book.loaded.metadata).pipe(
        Effect.orElseSucceed(() => null),
      );
      yield* Effect.sync(() =>
        dispatchView({ type: "title", title: metadata?.title?.trim() || null }),
      );
      const start = yield* Effect.tryPromise(() => book.loaded.navigation).pipe(
        Effect.map(firstChapterHref),
        // oxlint-disable-next-line no-useless-undefined
        Effect.orElseSucceed(() => undefined),
      );
      yield* Effect.tryPromise(async () => {
        // Try the most specific target first, then progressively fall back.
        // A TOC/landmark href (`start`) can fail to resolve to a spine item
        // ("No Section Found") when it doesn't match the canonicalized spine
        // href, so we end at epub.js's own "first linear section" behavior
        // (`display()` with no target) and finally spine index 0.
        const candidates: (string | number | undefined)[] = [
          ...(initialEpubCfi ? [initialEpubCfi] : []),
          start,
          undefined,
          0,
        ];
        for (const target of candidates) {
          try {
            await (rendition.display as (t?: string | number) => Promise<void>)(target);
            return;
          } catch {
            // Fall through to the next, less specific target.
          }
        }
        throw new Error("No displayable section found in epub");
      });
      yield* Effect.sync(() => publish({ book, rendition }));
      yield* Effect.sync(showLocation);
    });

    const fiber = Effect.runFork(
      load().pipe(
        Effect.tapError((error) => Effect.sync(() => console.error("failed to open epub", error))),
        Effect.ignore,
      ),
    );

    return () => {
      clearInterval(poll);
      for (const removeContentKeydown of removeContentKeydowns) removeContentKeydown();
      Effect.runFork(Fiber.interrupt(fiber));
      publish(null);
      rendition.destroy();
      book.destroy();
    };
  }, [file, initialEpubCfi, swipeRef, spreadModeRef]);

  useEffect(() => {
    if (!ready) return;
    const el = containerRef.current;
    const liveView = viewRef.current;
    if (!el || !liveView) return;
    const { rendition } = liveView;
    let resizeFrame: number | undefined;
    const resizeObserver = new ResizeObserver(() => {
      if (suspendResizeRef.current) return;
      if (resizeFrame !== undefined) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = undefined;
        try {
          rendition.resize(el.clientWidth, el.clientHeight);
          const loc = rendition.currentLocation() as unknown as
            | {
                start?: { index: number; cfi?: string; displayed?: { page: number } };
                atStart?: boolean;
                atEnd?: boolean;
              }
            | undefined;
          const start = loc?.start;
          dispatchView({
            type: "viewport",
            raw: start?.displayed
              ? {
                  index: start.index,
                  cfi: start.cfi ?? null,
                  page: start.displayed.page,
                  atStart: loc?.atStart ?? false,
                  atEnd: loc?.atEnd ?? false,
                }
              : undefined,
          });
        } catch (error) {
          console.error("failed to resize rendition", error);
        }
      });
    });
    resizeObserver.observe(el);
    return () => {
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
    };
  }, [ready, suspendResizeRef]);

  useEffect(() => {
    if (!ready || suspendResize) return;
    const el = containerRef.current;
    const liveView = viewRef.current;
    if (!el || !liveView) return;
    const frame = requestAnimationFrame(() => {
      liveView.rendition.resize(el.clientWidth, el.clientHeight);
      dispatchView({ type: "viewport" });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, suspendResize]);

  // Recompute the page-turn total whenever the book opens, the zoom changes, or
  // the viewport resizes. Each run is a forked fiber; a newer trigger interrupts
  // the one in flight (and the debounce coalesces bursts of resize/zoom events).
  // The previous total stays on screen until the new one lands.
  useEffect(() => {
    if (!ready) return;
    const el = containerRef.current;
    const liveView = viewRef.current;
    if (!el || !liveView) return;
    const { book } = liveView;
    const width = el.clientWidth;
    const height = el.clientHeight;
    const pct = fontSize;
    const spread = spreadModeRef.current;

    const seq = ++measureSeqRef.current;
    const measure = Effect.fn("EpubReader.measurePagination")(function* () {
      if (seq !== measureSeqRef.current) return;
      const result = yield* Effect.tryPromise(() =>
        measurePagination(book, width, height, pct, spread, () => seq !== measureSeqRef.current),
      );
      if (result && seq === measureSeqRef.current) {
        yield* Effect.sync(() => dispatchView({ type: "pagination", pagination: result }));
      }
    });
    const fiber = Effect.runFork(
      measure().pipe(
        Effect.delay("250 millis"),
        Effect.tapError((error) =>
          Effect.sync(() => console.error("failed to paginate epub", error)),
        ),
        Effect.ignore,
      ),
    );

    return () => {
      bumpSeq(measureSeqRef);
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [ready, fontSize, viewportTick, pdfPageLayout, spreadModeRef]);

  const onView = useCallback((f: (view: LiveView) => void) => {
    const view = viewRef.current;
    if (view) f(view);
  }, []);
  const currentView = useCallback(() => viewRef.current, []);

  // Apply a live spread change (single ⇄ two-page) without reopening the book.
  // epub.js retains its annotation panes across this relayout, so repaint them
  // once the new column geometry is committed or highlights keep stale bounds.
  const prevLayoutRef = useRef(pdfPageLayout);
  useEffect(() => {
    if (!ready) {
      prevLayoutRef.current = pdfPageLayout;
      return;
    }
    if (prevLayoutRef.current === pdfPageLayout) return;
    prevLayoutRef.current = pdfPageLayout;
    const view = viewRef.current;
    if (!view) return;
    let cancelled = false;
    void (async () => {
      view.rendition.spread(pdfPageLayout === "auto" ? "auto" : "none");
      const loc = view.rendition.currentLocation() as unknown as
        | { start?: { cfi?: string } }
        | undefined;
      const cfi = loc?.start?.cfi;
      if (cfi) await view.rendition.display(cfi);
      await afterLayout();
      if (cancelled) return;
      for (const [id, drawn] of drawnCfiRef.current) {
        view.rendition.annotations.remove(drawn.cfi, "highlight");
        view.rendition.annotations.highlight(drawn.cfi, { id }, drawn.onClick, "bc-highlight");
      }
    })().catch((error: unknown) => console.error("failed to change epub spread", error));
    return () => {
      cancelled = true;
    };
  }, [pdfPageLayout, ready]);

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
        drawnCfiRef.current.set(id, { cfi, onClick });
      });
    },
    [onView],
  );
  const eraseHighlight = useCallback(
    (id: string) => {
      const drawn = drawnCfiRef.current.get(id);
      if (drawn === undefined) return;
      drawnCfiRef.current.delete(id);
      onView((v) => v.rendition.annotations.remove(drawn.cfi, "highlight"));
    },
    [onView],
  );
  const drawSearchHighlight = useCallback(
    (anchor: HighlightAnchor) => {
      if (anchor.kind !== "epub-cfi") return;
      onView((v) => {
        if ([...drawnCfiRef.current.values()].some((drawn) => drawn.cfi === anchor.value)) {
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
    dispatchView({ type: "selection", selection: null });
  }, []);
  const commitSelection = useCallback(
    (intent: SelectIntent = "note") => {
      const pending = pendingRef.current;
      if (pending) onSelectRef.current(epubAnchor(pending.cfi), pending.range, intent);
      dismissSelection();
    },
    [dismissSelection, onSelectRef],
  );

  const reader = useMemo<SourceReader>(
    () => makeEpubReader(() => viewRef.current?.book ?? null),
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
  useLayoutEffect(() => {
    openSearchRef.current = search.openSearch;
  }, [search.openSearch]);

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

  const position = useMemo<SourceReadingPosition | null>(() => {
    if (!raw?.cfi) return null;
    return { kind: "epub", cfi: raw.cfi, percentage: location?.percentage ?? 0 };
  }, [raw, location?.percentage]);

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
    position,
    snapshot: null,
    reader,
    search,
  };
}
