import * as Effect from "effect/Effect";
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
      void renderPage();
    },
    [renderPage, location, clearComposing],
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
    host.appendChild(wrap);
    wrapRef.current = wrap;
    canvasRef.current = canvas;
    textLayerRef.current = textLayer;
    highlightLayerRef.current = highlightLayer;
    underlineLayerRef.current = underlineLayer;
    composingLayerRef.current = composingLayer;

    let cancelled = false;
    void (async () => {
      try {
        const doc = await loadPdf(await file.arrayBuffer());
        if (cancelled) {
          void destroyPdf(doc);
          return;
        }
        docRef.current = doc;
        const meta = await doc.getMetadata().catch(() => null);
        const info = meta?.info as { Title?: string } | undefined;
        setTitle(info?.Title?.trim() || null);
        await renderPage();
        if (!cancelled) setReady(true);
      } catch (error) {
        if (!cancelled) console.error("failed to open pdf", error);
      }
    })();

    return () => {
      cancelled = true;
      renderSeqRef.current++;
      const doc = docRef.current;
      docRef.current = null;
      if (doc) void destroyPdf(doc);
      wrap.remove();
      wrapRef.current = null;
      setReady(false);
    };
  }, [file, renderPage]);

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
      setSelection(popupPoint(range.getBoundingClientRect(), undefined));
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [paintComposing]);

  const setFontSize = useCallback(
    (pct: number) => {
      setFontSizeState(pct);
      fontSizeRef.current = pct;
      void renderPage();
    },
    [renderPage],
  );
  const next = useCallback(() => goToPage(pageRef.current + 1), [goToPage]);
  const prev = useCallback(() => goToPage(pageRef.current - 1), [goToPage]);
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

  // Swipe to turn pages (mirrors the epub adapter's gesture wiring).
  useEffect(() => {
    let startX = 0;
    const host = containerRef.current;
    if (!host) return;
    const onStart = (e: TouchEvent) => (startX = e.changedTouches[0]?.clientX ?? 0);
    const onEnd = (e: TouchEvent) => {
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
