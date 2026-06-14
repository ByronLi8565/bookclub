import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  expandToWordBoundaries,
  pdfAnchor,
  popupPoint,
  scanText,
  type HighlightAnchor,
  type PdfRect,
  type SearchMatch,
  type SourceReader,
} from "../../notes/highlights.ts";
import { useReaderPrefs } from "../../settings/readerPrefs.ts";
import {
  destroyPdf,
  loadPdf,
  loadTextLayerCtor,
  pageGeometry,
  rectsForRange,
  type PageGeometry,
  type PDFDocumentProxy,
} from "../../sources/pdf.ts";
import { useReaderSearch } from "./useReaderSearch.ts";
import type { OnSelect, SourceLocation, SourceView } from "./sourceView.ts";

// A highlight the adapter has been told to paint, kept so page navigation can
// repaint the overlays for whichever page is now showing.
interface Drawn {
  anchor: HighlightAnchor;
  onClick: () => void;
}

// Navigation/zoom tunables, grouped so the paging + zoom feel is easy to adjust
// (or later expose as user settings) without hunting through the adapter.
const READER_NAV = {
  // Fraction of the visible height an arrow key scrolls before it turns a page.
  // 1 = one full screen
  scrollStepFraction: 1,
  // px tolerance for treating the page's top/bottom edge as fully in view.
  edgeEpsilon: 20,
  // When a page opens, skip its top whitespace and rest the first line this many
  // CSS px below the pane's top. 0 would pin text flush to the edge.
  textTopMargin: 24,
  // Zoom bounds (percent of fit-to-width) and trackpad-pinch sensitivity.
  minZoom: 50,
  maxZoom: 400,
  pinchWheelSensitivity: 0.01,
} as const;

// The PDF source adapter: a PDF.js single-page view behind the format-agnostic
// SourceView. Anchors are page + normalized rects; selection, search, and
// rebind all flow through the page text layer.
export function usePdfSourceView(
  file: File | null,
  onSelect: OnSelect,
  onSwipe?: (dir: "left" | "right") => void,
): SourceView {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;
  // Smart-arrow mode, mirrored to a ref so the navigation callbacks read the
  // latest value without being re-created on every preference change.
  const { smartArrows } = useReaderPrefs();
  const smartArrowsRef = useRef(smartArrows);
  smartArrowsRef.current = smartArrows;

  const [ready, setReady] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const [fontSize, setFontSizeState] = useState(100);
  const [location, setLocation] = useState<SourceLocation | null>(null);
  const [selection, setSelection] = useState<{ x: number; y: number } | null>(null);

  const docRef = useRef<PDFDocumentProxy | null>(null);
  const pageRef = useRef(1);
  const fontSizeRef = useRef(100);
  fontSizeRef.current = fontSize;
  // DOM layers, built once the container + file are ready.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const highlightLayerRef = useRef<HTMLDivElement | null>(null);
  const underlineLayerRef = useRef<HTMLDivElement | null>(null);
  const composingLayerRef = useRef<HTMLDivElement | null>(null);
  // Per-page text + geometry, cached so search/locate/render don't re-extract.
  const geometryRef = useRef<Map<number, PageGeometry>>(new Map());
  const drawnRef = useRef<Map<string, Drawn>>(new Map());
  const underlineRef = useRef<HighlightAnchor | null>(null);
  const pendingRef = useRef<{ anchor: HighlightAnchor; range: Range; clear: () => void } | null>(
    null,
  );
  // Bumped on each render so a late async render can detect it was superseded.
  const renderSeqRef = useRef(0);

  const geometryFor = useCallback(async (pageNum: number): Promise<PageGeometry | null> => {
    const doc = docRef.current;
    if (!doc || pageNum < 1 || pageNum > doc.numPages) return null;
    const cached = geometryRef.current.get(pageNum);
    if (cached) return cached;
    const geom = await pageGeometry(await doc.getPage(pageNum));
    geometryRef.current.set(pageNum, geom);
    return geom;
  }, []);

  // The px scroll range that keeps the page's *text* within the pane: `floor`
  // parks the first line just below the top (trimming the large top margin many
  // PDFs bake in), `ceil` parks the last line just above the bottom. Both are
  // clamped to the real scrollable range, so navigation never lands in the page
  // box's whitespace. Reads cached geometry — the current page is always
  // rendered, hence cached — and falls back to the full range when absent.
  const scrollBounds = useCallback((): { floor: number; ceil: number } => {
    const scroller = scrollerRef.current;
    const wrap = wrapRef.current;
    if (!scroller || !wrap) return { floor: 0, ceil: 0 };
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const geom = geometryRef.current.get(pageRef.current);
    if (!geom || geom.runs.length === 0) return { floor: 0, ceil: maxScroll };
    const h = wrap.clientHeight;
    const minY = Math.min(...geom.runs.map((run) => run.y));
    const maxY = Math.max(...geom.runs.map((run) => run.y + run.height));
    const floor = Math.min(maxScroll, Math.max(0, minY * h - READER_NAV.textTopMargin));
    const ceil = Math.max(
      floor,
      Math.min(maxScroll, maxY * h + READER_NAV.textTopMargin - scroller.clientHeight),
    );
    return { floor, ceil };
  }, []);

  // Park the current page at the top of its text, ensuring geometry is loaded.
  const scrollToTextTop = useCallback(async (): Promise<void> => {
    const pageNum = pageRef.current;
    await geometryFor(pageNum);
    const scroller = scrollerRef.current;
    if (!scroller || pageNum !== pageRef.current) return;
    scroller.scrollTop = scrollBounds().floor;
  }, [geometryFor, scrollBounds]);

  // Paint overlay divs for the rects of `anchor` (only if it's on the current
  // page) into `layer`, tagged so they can be removed by highlight id.
  const paintRects = (layer: HTMLDivElement, id: string, anchor: HighlightAnchor, cls: string) => {
    if (anchor.kind !== "pdf-text" || anchor.page !== pageRef.current) return;
    const { clientWidth: w, clientHeight: h } = layer;
    for (const rect of anchor.rects) {
      const div = document.createElement("div");
      div.className = cls;
      div.dataset.hid = id;
      div.style.position = "absolute";
      div.style.left = `${rect.x * w}px`;
      div.style.top = `${rect.y * h}px`;
      div.style.width = `${rect.width * w}px`;
      div.style.height = `${rect.height * h}px`;
      if (cls === "bc-highlight") {
        div.style.cursor = "pointer";
        div.addEventListener("click", () => drawnRef.current.get(id)?.onClick());
      }
      layer.appendChild(div);
    }
  };

  const repaintHighlights = useCallback(() => {
    const layer = highlightLayerRef.current;
    if (!layer) return;
    layer.replaceChildren();
    for (const [id, { anchor }] of drawnRef.current) paintRects(layer, id, anchor, "bc-highlight");
  }, []);

  const repaintUnderline = useCallback(() => {
    const layer = underlineLayerRef.current;
    if (!layer) return;
    layer.replaceChildren();
    if (underlineRef.current) paintRects(layer, "search", underlineRef.current, "bc-search");
  }, []);

  // The live in-progress selection, painted with the same look as a saved
  // highlight (the native browser selection is hidden via CSS).
  const clearComposing = useCallback(() => {
    composingLayerRef.current?.replaceChildren();
  }, []);
  const paintComposing = useCallback((rects: PdfRect[]) => {
    const layer = composingLayerRef.current;
    if (!layer) return;
    layer.replaceChildren();
    const { clientWidth: w, clientHeight: h } = layer;
    for (const rect of rects) {
      const div = document.createElement("div");
      div.className = "bc-highlight";
      div.style.position = "absolute";
      div.style.left = `${rect.x * w}px`;
      div.style.top = `${rect.y * h}px`;
      div.style.width = `${rect.width * w}px`;
      div.style.height = `${rect.height * h}px`;
      layer.appendChild(div);
    }
  }, []);

  // Render the current page: canvas, text layer, then repaint overlays.
  const renderPage = useCallback(async () => {
    const doc = docRef.current;
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const textLayer = textLayerRef.current;
    if (!doc || !wrap || !canvas || !textLayer) return;

    const seq = ++renderSeqRef.current;
    const pageNum = pageRef.current;
    const page = await doc.getPage(pageNum);
    if (seq !== renderSeqRef.current) return;

    // Fit the page to the container width, scaled by the zoom control.
    const base = page.getViewport({ scale: 1 });
    const fit = (wrap.parentElement?.clientWidth ?? base.width) / base.width;
    const scale = fit * (fontSizeRef.current / 100);
    const viewport = page.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;

    wrap.style.width = `${viewport.width}px`;
    wrap.style.height = `${viewport.height}px`;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    if (seq !== renderSeqRef.current) return;

    // (Re)build the selectable text layer over the canvas. PDF.js sizes each
    // text run through `--total-scale-factor`, so it must match the viewport
    // scale or the spans (and the native selection) render mis-sized/off.
    textLayer.replaceChildren();
    textLayer.style.width = `${viewport.width}px`;
    textLayer.style.height = `${viewport.height}px`;
    textLayer.style.setProperty("--total-scale-factor", String(scale));
    textLayer.style.setProperty("--scale-factor", String(scale));
    const TextLayer = await loadTextLayerCtor();
    if (seq !== renderSeqRef.current) return;
    const tl = new TextLayer({
      textContentSource: await page.getTextContent(),
      container: textLayer,
      viewport,
    });
    await tl.render();
    if (seq !== renderSeqRef.current) return;

    repaintHighlights();
    repaintUnderline();
    setLocation({
      page: pageNum,
      total: doc.numPages,
      percentage: doc.numPages > 0 ? pageNum / doc.numPages : 0,
      atStart: pageNum <= 1,
      atEnd: pageNum >= doc.numPages,
    });
  }, [repaintHighlights, repaintUnderline]);

  const goToPage = useCallback(
    (pageNum: number) => {
      const doc = docRef.current;
      if (!doc) return;
      const clamped = Math.min(Math.max(1, pageNum), doc.numPages);
      if (clamped === pageRef.current && location) return;
      pageRef.current = clamped;
      setSelection(null);
      pendingRef.current = null;
      clearComposing();
      // Park the freshly-rendered page at the top of its text.
      void renderPage().then(() => scrollToTextTop());
    },
    [renderPage, location, clearComposing, scrollToTextTop],
  );

  // Scroll within the current page by one capped step, bounded by the page's
  // *text* (floor = first line, ceil = last line) rather than the raw page box,
  // returning false when already pinned to that edge so the caller turns the
  // page. A page whose text fits the viewport reports "at edge" in both
  // directions, so the first key press turns straight away.
  const scrollWithinPage = useCallback(
    (dir: "down" | "up"): boolean => {
      // "off" disables intra-page scrolling: arrows turn the page immediately.
      const mode = smartArrowsRef.current;
      if (mode === "off") return false;
      const scroller = scrollerRef.current;
      if (!scroller) return false;
      const { floor, ceil } = scrollBounds();
      if (ceil - floor <= READER_NAV.edgeEpsilon) return false;
      const atDown = scroller.scrollTop >= ceil - READER_NAV.edgeEpsilon;
      const atUp = scroller.scrollTop <= floor + READER_NAV.edgeEpsilon;
      if ((dir === "down" && atDown) || (dir === "up" && atUp)) return false;
      const step = scroller.clientHeight * READER_NAV.scrollStepFraction;
      const target =
        dir === "down"
          ? Math.min(ceil, scroller.scrollTop + step)
          : Math.max(floor, scroller.scrollTop - step);
      scroller.scrollTo({ top: target, behavior: mode === "smooth" ? "smooth" : "auto" });
      return true;
    },
    [scrollBounds],
  );

  // Load the document and build the DOM layers once the container is mounted.
  useEffect(() => {
    const host = containerRef.current;
    if (!file || !host) return;

    setReady(false);
    setLocation(null);
    setTitle(null);
    geometryRef.current.clear();
    drawnRef.current.clear();
    underlineRef.current = null;
    pageRef.current = 1;

    // A scroll container owns overflow so zooming grows the page *inside* the
    // pane (scrolling/clipping) instead of bursting out of it. The page wrapper
    // is centered within it.
    const scroller = document.createElement("div");
    scroller.className = "pdf-scroller";
    const wrap = document.createElement("div");
    wrap.className = "pdf-page";
    wrap.style.position = "relative";
    wrap.style.margin = "0 auto";
    const canvas = document.createElement("canvas");
    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";
    const highlightLayer = document.createElement("div");
    highlightLayer.className = "pdf-highlights";
    const underlineLayer = document.createElement("div");
    underlineLayer.className = "pdf-underlines";
    const composingLayer = document.createElement("div");
    composingLayer.className = "pdf-composing";
    for (const layer of [highlightLayer, underlineLayer, composingLayer]) {
      layer.style.position = "absolute";
      layer.style.inset = "0";
      layer.style.pointerEvents = "none";
    }
    // Canvas (paint) below, overlays above it, text layer on top for selection.
    for (const child of [canvas, highlightLayer, underlineLayer, composingLayer, textLayer])
      wrap.appendChild(child);
    scroller.appendChild(wrap);
    host.appendChild(scroller);
    scrollerRef.current = scroller;
    wrapRef.current = wrap;
    canvasRef.current = canvas;
    textLayerRef.current = textLayer;
    highlightLayerRef.current = highlightLayer;
    underlineLayerRef.current = underlineLayer;
    composingLayerRef.current = composingLayer;

    // Open + render as a forked fiber so the cleanup can interrupt it instead of
    // threading a `cancelled` flag through every async step. The document is
    // committed to `docRef` synchronously inside the load step (before any
    // interruptible boundary), so teardown can always dispose it.
    const fiber = Effect.runFork(
      Effect.gen(function* () {
        const doc = yield* Effect.promise(async () => {
          const loaded = await loadPdf(await file.arrayBuffer());
          docRef.current = loaded;
          return loaded;
        });
        const meta = yield* Effect.promise(() => doc.getMetadata().catch(() => null));
        const info = meta?.info as { Title?: string } | undefined;
        setTitle(info?.Title?.trim() || null);
        yield* Effect.promise(() => renderPage());
        yield* Effect.promise(() => scrollToTextTop());
        setReady(true);
      }).pipe(Effect.catchCause(() => Effect.sync(() => console.error("failed to open pdf")))),
    );

    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
      renderSeqRef.current++;
      const doc = docRef.current;
      docRef.current = null;
      if (doc) void destroyPdf(doc);
      scroller.remove();
      scrollerRef.current = null;
      wrapRef.current = null;
      setReady(false);
    };
  }, [file, renderPage, scrollToTextTop]);

  // Surface a selection inside the text layer as a pending anchor + popup. The
  // text layer lives in the top document, so `selectionchange` fires normally.
  useEffect(() => {
    const onSelectionChange = () => {
      const textLayer = textLayerRef.current;
      const wrap = wrapRef.current;
      if (!textLayer || !wrap) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const raw = sel.getRangeAt(0);
      if (!textLayer.contains(raw.commonAncestorContainer)) return;
      const range = expandToWordBoundaries(raw);

      const box = wrap.getBoundingClientRect();
      const rects: PdfRect[] = [...range.getClientRects()].map((r) => ({
        x: (r.left - box.left) / box.width,
        y: (r.top - box.top) / box.height,
        width: r.width / box.width,
        height: r.height / box.height,
      }));
      if (rects.length === 0) return;
      pendingRef.current = {
        anchor: pdfAnchor(pageRef.current, rects),
        range,
        clear: () => sel.removeAllRanges(),
      };
      paintComposing(rects);
      setSelection(popupPoint(range.getBoundingClientRect()));
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [paintComposing]);

  const setFontSize = useCallback(
    (pct: number) => {
      const clamped = Math.min(READER_NAV.maxZoom, Math.max(READER_NAV.minZoom, Math.round(pct)));
      if (clamped === fontSizeRef.current) return;
      setFontSizeState(clamped);
      fontSizeRef.current = clamped;
      void renderPage();
    },
    [renderPage],
  );
  // Advance only once the bottom of the page is in view; otherwise scroll down.
  const next = useCallback(() => {
    if (scrollWithinPage("down")) return;
    goToPage(pageRef.current + 1);
  }, [scrollWithinPage, goToPage]);
  // Mirror for going back: scroll up first, then turn to the previous page.
  const prev = useCallback(() => {
    if (scrollWithinPage("up")) return;
    goToPage(pageRef.current - 1);
  }, [scrollWithinPage, goToPage]);
  const goTo = useCallback(
    (anchor: HighlightAnchor) => {
      if (anchor.kind === "pdf-text") goToPage(anchor.page);
    },
    [goToPage],
  );

  const drawHighlight = useCallback(
    (id: string, anchor: HighlightAnchor, onClick: () => void) => {
      drawnRef.current.set(id, { anchor, onClick });
      repaintHighlights();
    },
    [repaintHighlights],
  );
  const eraseHighlight = useCallback(
    (id: string) => {
      drawnRef.current.delete(id);
      repaintHighlights();
    },
    [repaintHighlights],
  );
  const drawUnderline = useCallback(
    (anchor: HighlightAnchor) => {
      underlineRef.current = anchor;
      repaintUnderline();
    },
    [repaintUnderline],
  );
  const eraseUnderline = useCallback(() => {
    underlineRef.current = null;
    repaintUnderline();
  }, [repaintUnderline]);

  const dismissSelection = useCallback(() => {
    pendingRef.current?.clear();
    pendingRef.current = null;
    clearComposing();
    setSelection(null);
  }, [clearComposing]);
  const commitSelection = useCallback(() => {
    const pending = pendingRef.current;
    if (pending) onSelectRef.current(pending.anchor, pending.range);
    dismissSelection();
  }, [dismissSelection]);

  // Pinch-to-zoom, scoped to the PDF scroller so it only affects the page (the
  // browser's own page zoom is suppressed). Trackpad pinches arrive as
  // ctrl+wheel; touch pinches are tracked from the two-finger distance.
  useEffect(() => {
    if (!ready) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // a real scroll, leave it to the container
      e.preventDefault();
      setFontSize(fontSizeRef.current * (1 - e.deltaY * READER_NAV.pinchWheelSensitivity));
    };
    const dist = (t: TouchList) =>
      Math.hypot(
        (t[0]?.clientX ?? 0) - (t[1]?.clientX ?? 0),
        (t[0]?.clientY ?? 0) - (t[1]?.clientY ?? 0),
      );
    let pinchStartDist = 0;
    let pinchStartZoom = 100;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      pinchStartDist = dist(e.touches);
      pinchStartZoom = fontSizeRef.current;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || pinchStartDist <= 0) return;
      e.preventDefault();
      setFontSize((pinchStartZoom * dist(e.touches)) / pinchStartDist);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchStartDist = 0;
    };

    scroller.addEventListener("wheel", onWheel, { passive: false });
    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: false });
    scroller.addEventListener("touchend", onTouchEnd);
    return () => {
      scroller.removeEventListener("wheel", onWheel);
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
      scroller.removeEventListener("touchend", onTouchEnd);
    };
  }, [ready, setFontSize]);

  // Swipe to turn pages (mirrors the epub adapter's gesture wiring). Ignores
  // multi-touch so it never fires mid-pinch.
  useEffect(() => {
    let startX = 0;
    let multiTouch = false;
    const host = containerRef.current;
    if (!host) return;
    const onStart = (e: TouchEvent) => {
      multiTouch = e.touches.length > 1;
      startX = e.changedTouches[0]?.clientX ?? 0;
    };
    const onEnd = (e: TouchEvent) => {
      if (multiTouch || e.touches.length > 0) return;
      const dx = (e.changedTouches[0]?.clientX ?? 0) - startX;
      if (Math.abs(dx) < 60) return;
      onSwipeRef.current?.(dx < 0 ? "left" : "right");
    };
    host.addEventListener("touchstart", onStart);
    host.addEventListener("touchend", onEnd);
    return () => {
      host.removeEventListener("touchstart", onStart);
      host.removeEventListener("touchend", onEnd);
    };
  }, []);

  const reader = useMemo<SourceReader>(() => {
    // Find the quote on a given page; null if absent. Prefers the contextual
    // (prefix+exact+suffix) match, then bare exact, mirroring the epub path.
    const locateOnPage = (
      geom: PageGeometry,
      quote: { prefix: string; exact: string; suffix: string },
    ) => {
      const contextual = quote.prefix + quote.exact + quote.suffix;
      let start = geom.text.indexOf(contextual);
      if (start >= 0) start += quote.prefix.length;
      else start = geom.text.indexOf(quote.exact);
      if (start < 0) return null;
      return rectsForRange(geom, start, start + quote.exact.length);
    };
    return {
      locateHighlight: (h) =>
        Effect.tryPromise(async () => {
          const anchor = h.anchor;
          if (anchor.kind !== "pdf-text") return null;
          const doc = docRef.current;
          if (!doc) return anchor;
          // Try the stored page first, then scan the whole document.
          const order = [
            anchor.page,
            ...Array.from({ length: doc.numPages }, (_, i) => i + 1).filter(
              (n) => n !== anchor.page,
            ),
          ];
          for (const pageNum of order) {
            const geom = await geometryFor(pageNum);
            if (!geom) continue;
            const rects = locateOnPage(geom, h.quote);
            if (rects && rects.length > 0) return pdfAnchor(pageNum, rects);
          }
          // Fall back to the stored anchor so an existing highlight still paints.
          return anchor.rects.length > 0 ? anchor : null;
        }).pipe(Effect.orElseSucceed(() => null)),
      search: (query) =>
        Effect.tryPromise(async () => {
          const doc = docRef.current;
          if (!doc || query.trim() === "") return [] as SearchMatch[];
          const matches: SearchMatch[] = [];
          for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
            const geom = await geometryFor(pageNum);
            if (!geom) continue;
            for (const { start, excerpt } of scanText(geom.text, query)) {
              const rects = rectsForRange(geom, start, start + query.length);
              matches.push({ anchor: pdfAnchor(pageNum, rects), excerpt });
            }
          }
          return matches;
        }).pipe(Effect.orElseSucceed(() => [] as SearchMatch[])),
    };
  }, [geometryFor]);

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
