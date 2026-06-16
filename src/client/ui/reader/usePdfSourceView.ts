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
import { useReaderPrefs } from "../../settings/userPrefs.ts";
import type { SourceReadingPosition } from "../../../shared/types/readingPositions.ts";
import {
  destroyPdf,
  loadPdf,
  loadTextLayerBuilderCtor,
  pageGeometry,
  rectsForRange,
  type PageGeometry,
  type PDFDocumentProxy,
} from "../../sources/pdf.ts";
import { useReaderSearch } from "./useReaderSearch.ts";
import type { OnSelect, SourceLocation, SourceView } from "./sourceView.ts";
import type { TextLayerBuilder } from "pdfjs-dist/web/pdf_viewer.mjs";

interface Drawn {
  anchor: HighlightAnchor;
  onClick: () => void;
}

const READER_NAV = {
  scrollStepFraction: 1,
  edgeEpsilon: 20,
  textTopMargin: 24,
  minZoom: 50,
  maxZoom: 400,
  pinchWheelSensitivity: 0.01,
} as const;

const PDF_RECT_Y_NUDGE_PX = 4;

// Client rects for only the *text* inside a range that lives within `within`.
// Walking text nodes (rather than calling range.getClientRects() directly)
// ignores element boxes — notably pdf.js's `.endOfContent` selection sink, which
// is stretched to the full layer during a drag and would otherwise inflate a
// highlight to the whole page — and confines rects to the page's own text.
function textClientRects(range: Range, within: Node): DOMRect[] {
  const walker = document.createTreeWalker(within, NodeFilter.SHOW_TEXT);
  const rects: DOMRect[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    const sub = document.createRange();
    sub.selectNodeContents(node);
    if (node === range.startContainer) sub.setStart(node, range.startOffset);
    if (node === range.endContainer) sub.setEnd(node, range.endOffset);
    rects.push(...sub.getClientRects());
  }
  return rects;
}

// Union of a set of client rects, used to anchor the selection popup without
// pulling in pdf.js's stretched `.endOfContent` box.
function boundingRect(rects: DOMRect[]): DOMRect {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  return new DOMRect(left, top, right - left, bottom - top);
}

function bumpSeq(ref: { current: number }): void {
  ref.current += 1;
}

export function usePdfSourceView(
  file: File | null,
  onSelect: OnSelect,
  onSearchHighlightCleared?: () => void,
  initialPosition?: SourceReadingPosition | null,
): SourceView {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const { smartArrows } = useReaderPrefs();
  const smartArrowsRef = useRef(smartArrows);
  smartArrowsRef.current = smartArrows;

  const [ready, setReady] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const [fontSize, setFontSizeState] = useState(100);
  const [location, setLocation] = useState<SourceLocation | null>(null);
  const [position, setPosition] = useState<SourceReadingPosition | null>(null);
  const [selection, setSelection] = useState<{ x: number; y: number } | null>(null);

  const docRef = useRef<PDFDocumentProxy | null>(null);
  const pageRef = useRef(1);
  const fontSizeRef = useRef(100);
  fontSizeRef.current = fontSize;
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const textLayerBuilderRef = useRef<TextLayerBuilder | null>(null);
  const highlightLayerRef = useRef<HTMLDivElement | null>(null);
  const flashLayerRef = useRef<HTMLDivElement | null>(null);
  const underlineLayerRef = useRef<HTMLDivElement | null>(null);
  const geometryRef = useRef<Map<number, PageGeometry>>(new Map());
  const drawnRef = useRef<Map<string, Drawn>>(new Map());
  const underlineRef = useRef<HighlightAnchor | null>(null);
  const pendingRef = useRef<{ anchor: HighlightAnchor; range: Range; clear: () => void } | null>(
    null,
  );
  const renderSeqRef = useRef(0);
  const initialPdfPage = initialPosition?.kind === "pdf" ? initialPosition.page : null;
  const initialPdfScrollRatio =
    initialPosition?.kind === "pdf" ? initialPosition.scrollRatio : null;
  const initialPdfZoom = initialPosition?.kind === "pdf" ? initialPosition.zoom : null;
  const initialPdfPercentage = initialPosition?.kind === "pdf" ? initialPosition.percentage : 0;

  const geometryFor = useCallback(async (pageNum: number): Promise<PageGeometry | null> => {
    const doc = docRef.current;
    if (!doc || pageNum < 1 || pageNum > doc.numPages) return null;
    const cached = geometryRef.current.get(pageNum);
    if (cached) return cached;
    const geom = await pageGeometry(await doc.getPage(pageNum));
    geometryRef.current.set(pageNum, geom);
    return geom;
  }, []);

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

  const scrollToTextTop = useCallback(async (): Promise<void> => {
    const pageNum = pageRef.current;
    await geometryFor(pageNum);
    const scroller = scrollerRef.current;
    if (!scroller || pageNum !== pageRef.current) return;
    scroller.scrollTop = scrollBounds().floor;
  }, [geometryFor, scrollBounds]);

  const publishPosition = useCallback((): void => {
    const doc = docRef.current;
    const scroller = scrollerRef.current;
    if (!doc || !scroller) return;
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const scrollRatio = maxScroll > 0 ? scroller.scrollTop / maxScroll : 0;
    setPosition({
      kind: "pdf",
      page: pageRef.current,
      scrollRatio: Math.min(1, Math.max(0, scrollRatio)),
      zoom: fontSizeRef.current,
      percentage: doc.numPages > 0 ? (pageRef.current - 1 + scrollRatio) / doc.numPages : 0,
    });
  }, []);

  const scrollToPdfPosition = useCallback(
    (target: SourceReadingPosition): void => {
      if (target.kind !== "pdf") return;
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollTop = Math.min(maxScroll, Math.max(0, target.scrollRatio * maxScroll));
      publishPosition();
    },
    [publishPosition],
  );

  const scrollToAnchor = useCallback(
    async (anchor: HighlightAnchor): Promise<void> => {
      if (anchor.kind !== "pdf-text" || anchor.rects.length === 0) return;
      const pageNum = pageRef.current;
      await geometryFor(pageNum);
      const scroller = scrollerRef.current;
      const wrap = wrapRef.current;
      if (!scroller || !wrap || pageNum !== pageRef.current) return;
      const h = wrap.clientHeight;
      const top = Math.min(...anchor.rects.map((r) => r.y)) * h;
      const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const target = Math.min(maxScroll, Math.max(0, top - READER_NAV.textTopMargin));
      scroller.scrollTop = target;
    },
    [geometryFor],
  );

  const paintRects = (layer: HTMLDivElement, id: string, anchor: HighlightAnchor, cls: string) => {
    const painted: HTMLDivElement[] = [];
    if (anchor.kind !== "pdf-text" || anchor.page !== pageRef.current) return painted;
    const { clientWidth: w, clientHeight: h } = layer;
    for (const rect of anchor.rects) {
      const div = document.createElement("div");
      div.className = cls;
      div.dataset.hid = id;
      div.style.position = "absolute";
      div.style.left = `${rect.x * w}px`;
      div.style.top = `${rect.y * h + PDF_RECT_Y_NUDGE_PX}px`;
      div.style.width = `${rect.width * w}px`;
      div.style.height = `${rect.height * h}px`;
      if (cls === "bc-highlight") {
        div.style.cursor = "pointer";
        div.addEventListener("click", () => drawnRef.current.get(id)?.onClick());
      }
      layer.appendChild(div);
      painted.push(div);
    }
    return painted;
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

  const clearFlash = useCallback(() => {
    flashLayerRef.current?.replaceChildren();
  }, []);

  const flashHighlight = useCallback(
    (anchor: HighlightAnchor) => {
      const layer = flashLayerRef.current;
      if (!layer) return;
      clearFlash();
      const [first] = paintRects(layer, "jump", anchor, "bc-jump-flash");
      first?.addEventListener("animationend", clearFlash, { once: true });
    },
    [clearFlash],
  );

  // Build (but do not display) the text layer for a page, then swap it into the
  // page box once ready. Lives in a separate dynamically-imported chunk
  // (pdf_viewer.mjs); if it 404/403s on a deploy the page must still be fully
  // usable for viewing/zoom/paging — selection and in-page search are the only
  // casualties — so failures here are swallowed and never propagate.
  const renderTextLayer = useCallback(
    async (page: Awaited<ReturnType<PDFDocumentProxy["getPage"]>>, viewport: unknown, seq: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      try {
        const TextLayerBuilderCtor = await loadTextLayerBuilderCtor();
        if (seq !== renderSeqRef.current) return;
        const builder = new TextLayerBuilderCtor({ pdfPage: page });
        await builder.render({ viewport } as Parameters<typeof builder.render>[0]);
        if (seq !== renderSeqRef.current) {
          builder.cancel();
          builder.div.remove();
          return;
        }
        textLayerBuilderRef.current?.cancel();
        textLayerBuilderRef.current?.div.remove();
        textLayerBuilderRef.current = builder;
        textLayerRef.current = builder.div;
        wrap.appendChild(builder.div);
      } catch (error) {
        console.error("pdf text layer unavailable; selection and search disabled", error);
      }
    },
    [],
  );

  // `doubleBuffer` renders the new scale into a *detached* canvas and swaps it
  // in only once fully painted, instead of resizing/blanking the on-screen
  // canvas in place. It's used for the pinch commit, where the live page is
  // still CSS-scaled and must stay untouched until the crisp bitmap is ready —
  // otherwise the box resizes (and the canvas blanks) under the transform,
  // flashing a ballooned/empty frame. This mirrors pdf.js, which renders the
  // next scale off-screen and swaps when ready. For +/- and page turns the
  // in-place path is kept: it resizes the page box immediately, so layout
  // (scrollHeight, page-turn scroll math) stays correct with no deferral.
  const renderPage = useCallback(
    async (opts?: { doubleBuffer?: boolean }) => {
      const doc = docRef.current;
      const wrap = wrapRef.current;
      if (!doc || !wrap) return;

      const seq = ++renderSeqRef.current;
      const pageNum = pageRef.current;
      const page = await doc.getPage(pageNum);
      if (seq !== renderSeqRef.current) return;

      const base = page.getViewport({ scale: 1 });
      const fit = (wrap.parentElement?.clientWidth ?? base.width) / base.width;
      const scale = fit * (fontSizeRef.current / 100);
      const viewport = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      const applyWrapSize = () => {
        wrap.style.width = `${viewport.width}px`;
        wrap.style.height = `${viewport.height}px`;
        // The text-layer spans size their glyphs off this CSS var.
        wrap.style.setProperty("--total-scale-factor", String(scale));
        wrap.style.setProperty("--scale-factor", String(scale));
      };

      if (opts?.doubleBuffer) {
        const next = document.createElement("canvas");
        next.width = Math.floor(viewport.width * dpr);
        next.height = Math.floor(viewport.height * dpr);
        next.style.width = `${viewport.width}px`;
        next.style.height = `${viewport.height}px`;
        const ctx = next.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        await page.render({ canvas: next, canvasContext: ctx, viewport }).promise;
        if (seq !== renderSeqRef.current) return;
        // Atomic swap: replace the visible canvas and resize the box together,
        // so the browser only ever composites the old or the final frame. The
        // caller clears its transform / fixes scroll in the same microtask right
        // after this resolves — hence the text layer below must NOT be awaited
        // here (awaiting it would delay that reconciliation and flash).
        const prev = canvasRef.current;
        if (prev?.parentNode === wrap) wrap.replaceChild(next, prev);
        else wrap.insertBefore(next, wrap.firstChild);
        if (prev) {
          prev.width = prev.height = 0; // release the old backing store (iOS canvas memory).
        }
        canvasRef.current = next;
        applyWrapSize();
      } else {
        const canvas = canvasRef.current;
        if (!canvas) return;
        applyWrapSize();
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        if (seq !== renderSeqRef.current) return;
      }

      repaintHighlights();
      repaintUnderline();
      setLocation({
        page: pageNum,
        total: doc.numPages,
        percentage: doc.numPages > 0 ? pageNum / doc.numPages : 0,
        atStart: pageNum <= 1,
        atEnd: pageNum >= doc.numPages,
      });
      publishPosition();

      // Fire-and-forget so renderPage resolves at the swap (see above).
      void renderTextLayer(page, viewport, seq);
    },
    [repaintHighlights, repaintUnderline, publishPosition, renderTextLayer],
  );

  // Latest renderPage for use inside imperative touch handlers without making
  // the pinch effect re-subscribe on every renderPage identity change.
  const renderPageRef = useRef(renderPage);
  renderPageRef.current = renderPage;

  const goToPage = useCallback(
    async (pageNum: number, afterRender: () => Promise<void> = scrollToTextTop): Promise<void> => {
      const doc = docRef.current;
      if (!doc) return;
      const clamped = Math.min(Math.max(1, pageNum), doc.numPages);
      if (clamped === pageRef.current && location) {
        await afterRender();
        return;
      }
      pageRef.current = clamped;
      setSelection(null);
      pendingRef.current = null;
      clearFlash();
      // Land at the top of the freshly-entered page.
      if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
      await renderPage();
      await afterRender();
      publishPosition();
    },
    [renderPage, location, clearFlash, scrollToTextTop, publishPosition],
  );

  const scrollWithinPage = useCallback(
    (dir: "down" | "up"): boolean => {
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

  useEffect(() => {
    const host = containerRef.current;
    if (!file || !host) return;

    setReady(false);
    setLocation(null);
    setPosition(null);
    setTitle(null);
    geometryRef.current.clear();
    drawnRef.current.clear();
    underlineRef.current = null;
    pageRef.current = initialPdfPage === null ? 1 : Math.max(1, Math.round(initialPdfPage));
    if (initialPdfZoom !== null) {
      const zoom = Math.min(
        READER_NAV.maxZoom,
        Math.max(READER_NAV.minZoom, Math.round(initialPdfZoom)),
      );
      setFontSizeState(zoom);
      fontSizeRef.current = zoom;
    }

    const scroller = document.createElement("div");
    scroller.className = "pdf-scroller";
    const wrap = document.createElement("div");
    wrap.className = "pdf-page";
    wrap.style.position = "relative";
    wrap.style.margin = "0 auto";
    const canvas = document.createElement("canvas");
    const highlightLayer = document.createElement("div");
    highlightLayer.className = "pdf-highlights";
    const flashLayer = document.createElement("div");
    flashLayer.className = "pdf-jump-flash";
    const underlineLayer = document.createElement("div");
    underlineLayer.className = "pdf-underlines";
    for (const layer of [highlightLayer, flashLayer, underlineLayer]) {
      layer.style.position = "absolute";
      layer.style.inset = "0";
      layer.style.pointerEvents = "none";
    }
    // The text layer is created and appended per-render by the TextLayerBuilder.
    for (const child of [canvas, highlightLayer, flashLayer, underlineLayer])
      wrap.appendChild(child);
    scroller.appendChild(wrap);
    host.appendChild(scroller);
    scrollerRef.current = scroller;
    wrapRef.current = wrap;
    canvasRef.current = canvas;
    highlightLayerRef.current = highlightLayer;
    flashLayerRef.current = flashLayer;
    underlineLayerRef.current = underlineLayer;

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
        if (initialPdfPage !== null) {
          pageRef.current = Math.min(Math.max(1, pageRef.current), doc.numPages);
        }
        yield* Effect.promise(() => renderPage());
        yield* Effect.promise(async () => {
          if (
            initialPdfPage !== null &&
            initialPdfScrollRatio !== null &&
            initialPdfZoom !== null
          ) {
            scrollToPdfPosition({
              kind: "pdf",
              page: initialPdfPage,
              scrollRatio: initialPdfScrollRatio,
              zoom: initialPdfZoom,
              percentage: initialPdfPercentage,
            });
          } else {
            await scrollToTextTop();
          }
        });
        setReady(true);
      }).pipe(Effect.catchCause(() => Effect.sync(() => console.error("failed to open pdf")))),
    );

    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
      bumpSeq(renderSeqRef);
      clearFlash();
      textLayerBuilderRef.current?.cancel();
      textLayerBuilderRef.current = null;
      textLayerRef.current = null;
      const doc = docRef.current;
      docRef.current = null;
      if (doc) void destroyPdf(doc);
      scroller.remove();
      scrollerRef.current = null;
      wrapRef.current = null;
      flashLayerRef.current = null;
      setReady(false);
    };
  }, [
    file,
    renderPage,
    scrollToTextTop,
    scrollToPdfPosition,
    clearFlash,
    initialPdfPage,
    initialPdfScrollRatio,
    initialPdfZoom,
    initialPdfPercentage,
  ]);

  useEffect(() => {
    const clear = () => {
      if (!pendingRef.current) return;
      pendingRef.current = null;
      setSelection(null);
    };
    const onSelectionChange = () => {
      const textLayer = textLayerRef.current;
      const wrap = wrapRef.current;
      if (!textLayer || !wrap) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return clear();
      const raw = sel.getRangeAt(0);
      if (!raw.intersectsNode(textLayer)) return;
      const range = expandToWordBoundaries(raw);

      const domRects = textClientRects(range, textLayer);
      if (domRects.length === 0) return;
      const box = wrap.getBoundingClientRect();
      const rects: PdfRect[] = domRects.map((r) => ({
        x: (r.left - box.left) / box.width,
        y: (r.top - box.top) / box.height,
        width: r.width / box.width,
        height: r.height / box.height,
      }));
      pendingRef.current = {
        anchor: pdfAnchor(pageRef.current, rects),
        range,
        clear: () => sel.removeAllRanges(),
      };
      setSelection(popupPoint(boundingRect(domRects)));
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

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
  const next = useCallback(() => {
    if (scrollWithinPage("down")) return;
    void goToPage(pageRef.current + 1);
  }, [scrollWithinPage, goToPage]);
  const prev = useCallback(() => {
    if (scrollWithinPage("up")) return;
    void goToPage(pageRef.current - 1);
  }, [scrollWithinPage, goToPage]);
  const goTo = useCallback(
    async (anchor: HighlightAnchor): Promise<void> => {
      if (anchor.kind === "pdf-text") await goToPage(anchor.page, () => scrollToAnchor(anchor));
    },
    [goToPage, scrollToAnchor],
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
  const drawSearchHighlight = useCallback(
    (anchor: HighlightAnchor) => {
      underlineRef.current = anchor;
      repaintUnderline();
    },
    [repaintUnderline],
  );
  const eraseSearchHighlight = useCallback(() => {
    underlineRef.current = null;
    repaintUnderline();
  }, [repaintUnderline]);

  const dismissSelection = useCallback(() => {
    pendingRef.current?.clear();
    pendingRef.current = null;
    setSelection(null);
  }, []);
  const commitSelection = useCallback(() => {
    const pending = pendingRef.current;
    if (pending) onSelectRef.current(pending.anchor, pending.range);
    dismissSelection();
  }, [dismissSelection]);

  useEffect(() => {
    if (!ready) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const onScroll = () => publishPosition();
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
    const clampZoom = (z: number) =>
      Math.min(READER_NAV.maxZoom, Math.max(READER_NAV.minZoom, z));
    const midpoint = (t: TouchList) => ({
      x: ((t[0]?.clientX ?? 0) + (t[1]?.clientX ?? 0)) / 2,
      y: ((t[0]?.clientY ?? 0) + (t[1]?.clientY ?? 0)) / 2,
    });

    // Pinch state. We deliberately do NOT re-rasterize the PDF on every move —
    // that per-frame canvas render is what made pinch choppy and lag behind the
    // fingers. Instead, following pdf.js's TouchManager/PDFViewer approach, we
    // apply a cheap GPU `transform: scale()` to the already-rendered page during
    // the gesture (canvas + text/highlight layers scale together, anchored at
    // the pinch midpoint via transform-origin) and re-render crisply exactly
    // once when the pinch ends, fixing up scroll so the pinched point stays put.
    let pinching = false;
    let pinchStartDist = 0;
    let pinchStartZoom = 100;
    let liveZoom = 100;
    let focalX = 0;
    let focalY = 0;
    let focalFracX = 0.5;
    let focalFracY = 0.5;

    const beginPinch = (t: TouchList) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      pinchStartDist = dist(t) || 1;
      pinchStartZoom = fontSizeRef.current;
      liveZoom = pinchStartZoom;
      const mid = midpoint(t);
      focalX = mid.x;
      focalY = mid.y;
      const r = wrap.getBoundingClientRect();
      focalFracX = r.width > 0 ? (focalX - r.left) / r.width : 0.5;
      focalFracY = r.height > 0 ? (focalY - r.top) / r.height : 0.5;
      wrap.style.transformOrigin = `${focalX - r.left}px ${focalY - r.top}px`;
      wrap.style.willChange = "transform";
      pinching = true;
    };

    const commitPinch = async () => {
      pinching = false;
      const wrap = wrapRef.current;
      if (!wrap) return;
      const clearTransform = () => {
        wrap.style.transform = "";
        wrap.style.transformOrigin = "";
        wrap.style.willChange = "";
      };
      const clamped = Math.round(clampZoom(liveZoom));
      if (clamped === fontSizeRef.current) {
        clearTransform();
        return;
      }
      const sRect = scroller.getBoundingClientRect();
      const fx = focalX - sRect.left;
      const fy = focalY - sRect.top;
      setFontSizeState(clamped);
      fontSizeRef.current = clamped;
      // Re-render at the new scale off-screen and swap atomically, then drop the
      // temporary transform and place the focal content point back under the
      // fingers (fraction-based so it is robust to the auto-centering margins).
      // Double-buffering keeps the live (CSS-scaled) page visible until the
      // crisp bitmap is ready, so there is no flash at the end of the pinch.
      await renderPageRef.current({ doubleBuffer: true });
      clearTransform();
      const maxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollLeft = Math.min(
        maxLeft,
        Math.max(0, wrap.offsetLeft + focalFracX * wrap.offsetWidth - fx),
      );
      scroller.scrollTop = Math.min(
        maxTop,
        Math.max(0, wrap.offsetTop + focalFracY * wrap.offsetHeight - fy),
      );
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      beginPinch(e.touches);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      const wrap = wrapRef.current;
      if (!pinching || !wrap) {
        beginPinch(e.touches);
        return;
      }
      liveZoom = clampZoom((pinchStartZoom * dist(e.touches)) / pinchStartDist);
      wrap.style.transform = `scale(${liveZoom / pinchStartZoom})`;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!pinching) return;
      e.stopPropagation();
      if (e.touches.length < 2) void commitPinch();
    };
    const onTouchCancel = () => {
      if (pinching) void commitPinch();
    };
    const swallowGesture = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };

    scroller.addEventListener("scroll", onScroll);
    scroller.addEventListener("wheel", onWheel, { passive: false });
    scroller.addEventListener("touchstart", onTouchStart, { passive: false, capture: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    scroller.addEventListener("touchend", onTouchEnd, { capture: true });
    scroller.addEventListener("touchcancel", onTouchCancel, { capture: true });
    scroller.addEventListener("gesturestart", swallowGesture, { passive: false, capture: true });
    scroller.addEventListener("gesturechange", swallowGesture, { passive: false, capture: true });
    scroller.addEventListener("gestureend", swallowGesture, { passive: false, capture: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("wheel", onWheel);
      scroller.removeEventListener("touchstart", onTouchStart, { capture: true });
      scroller.removeEventListener("touchmove", onTouchMove, { capture: true });
      scroller.removeEventListener("touchend", onTouchEnd, { capture: true });
      scroller.removeEventListener("touchcancel", onTouchCancel, { capture: true });
      scroller.removeEventListener("gesturestart", swallowGesture, { capture: true });
      scroller.removeEventListener("gesturechange", swallowGesture, { capture: true });
      scroller.removeEventListener("gestureend", swallowGesture, { capture: true });
    };
  }, [ready, setFontSize, publishPosition]);

  const reader = useMemo<SourceReader>(() => {
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

  const search = useReaderSearch({
    reader,
    ready,
    goTo,
    drawSearchHighlight,
    eraseSearchHighlight,
    onSearchHighlightCleared,
  });

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
    reader,
    search,
  };
}
