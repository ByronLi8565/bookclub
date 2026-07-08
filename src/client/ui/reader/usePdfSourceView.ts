import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  expandToWordBoundaries,
  pdfAnchor,
  popupPoint,
  scanText,
  type HighlightAnchor,
  type PdfRect,
  type SearchMatch,
  type SourceReader,
} from "../../logic/notes/highlights.ts";
import { useReaderPrefs } from "../../logic/settings/userPrefs.ts";
import type { SourceReadingPosition } from "../../../shared/types/readingPositions.ts";
import {
  destroyPdf,
  loadPdf,
  loadTextLayerBuilderCtor,
  pageGeometry,
  rectsForRange,
  type PageGeometry,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "../../logic/sources/pdf.ts";
import {
  getCachedPdfDocument,
  hasCachedPdfDocument,
  putCachedPdfDocument,
} from "./engine/renderCache.ts";
import {
  getRenderSnapshot,
  putRenderSnapshot,
  type RenderSnapshot,
} from "./engine/renderSnapshot.ts";
import { useReaderSearch } from "./useReaderSearch.ts";
import {
  SPREAD_GUTTER_PX,
  cropBox,
  spreadEnd,
  spreadFits,
  spreadPages,
  spreadStart,
} from "./engine/pdfSpread.ts";
import { bumpSeq } from "./engine/seq.ts";
import { type OnSelect, type SelectIntent } from "./types.ts";
import { type SourceView } from "./types.ts";
import { type SourceLocation } from "./types.ts";
import { clamp } from "../../../shared/format.ts";
import { isMobileViewport } from "../shared/hooks/useIsMobile.ts";
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
  // Cap the canvas backing-store density. Phones report devicePixelRatio 3, so
  // an uncapped render rasterizes ~9x the CSS pixels — the dominant cost when
  // opening a PDF on mobile (and a hazard near iOS's per-canvas memory limit).
  // 2x is still visually crisp for text; everything else works in CSS px so
  // geometry/highlight/scroll math is unaffected by the cap.
  maxRenderDpr: 2,
  spreadGutterPx: SPREAD_GUTTER_PX,
  // Padding kept around the text when cropping a spread page to its text box.
  spreadCropPadPx: 16,
} as const;

const PDF_RECT_Y_NUDGE_PX = 4;

// Fraction (0..1) of a client-space point within `wrap`'s box, per axis. Used to
// remember which content point sits under the cursor/viewport-center so it can
// be restored after a re-render at a new zoom. Falls back to the center (0.5)
// when the box has no extent.
function focalFraction(
  wrap: HTMLElement,
  clientX: number,
  clientY: number,
): { fracX: number; fracY: number } {
  const r = wrap.getBoundingClientRect();
  return {
    fracX: r.width > 0 ? clamp((clientX - r.left) / r.width, 0, 1) : 0.5,
    fracY: r.height > 0 ? clamp((clientY - r.top) / r.height, 0, 1) : 0.5,
  };
}

// Scroll `scroller` so the given fraction of `wrap` lands at offset
// (offsetX, offsetY) from the scroller's top-left corner, clamped to range.
function scrollToFocalFraction(
  scroller: HTMLElement,
  wrap: HTMLElement,
  fracX: number,
  fracY: number,
  offsetX: number,
  offsetY: number,
): void {
  const maxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  scroller.scrollLeft = clamp(wrap.offsetLeft + fracX * wrap.offsetWidth - offsetX, 0, maxLeft);
  scroller.scrollTop = clamp(wrap.offsetTop + fracY * wrap.offsetHeight - offsetY, 0, maxTop);
}

// One rendered page within a spread. `el` is a clip viewport; `inner` is the
// full-page coordinate box that holds the canvas, text layer, and overlay
// layers — all positioned in fractions of *this page*. In a two-page spread
// `inner` is offset within `el` so only the text region shows (no wide inner
// margins / vertical whitespace); in single-page mode `inner` fills `el`. Either
// way every page-relative rect calculation (highlights, selection, search)
// stays valid because the layers live in full-page coordinates inside `inner`.
interface Pane {
  el: HTMLDivElement;
  inner: HTMLDivElement;
  canvas: HTMLCanvasElement;
  highlight: HTMLDivElement;
  flash: HTMLDivElement;
  underline: HTMLDivElement;
  selection: HTMLDivElement;
  textLayer: HTMLDivElement | null;
  builder: TextLayerBuilder | null;
  page: number | null;
  // Render metrics (CSS px) used by the scroll math, which works in full-page
  // coordinates and must account for the crop offset.
  pageHeightPx: number;
  cropTopPx: number;
}

type PaneLayerKey = "highlight" | "flash" | "underline" | "selection";

function createPane(): Pane {
  const el = document.createElement("div");
  el.className = "pdf-pane";
  const inner = document.createElement("div");
  inner.className = "pdf-pane-inner";
  inner.style.position = "absolute";
  el.appendChild(inner);
  const canvas = document.createElement("canvas");
  const mkLayer = (cls: string) => {
    const layer = document.createElement("div");
    layer.className = cls;
    layer.style.cssText = "position:absolute;inset:0;pointer-events:none;";
    return layer;
  };
  const highlight = mkLayer("pdf-highlights");
  const flash = mkLayer("pdf-jump-flash");
  const underline = mkLayer("pdf-underlines");
  const selection = mkLayer("pdf-selection");
  // The text layer is appended per-render by the TextLayerBuilder.
  for (const child of [canvas, highlight, flash, underline, selection]) inner.appendChild(child);
  return {
    el,
    inner,
    canvas,
    highlight,
    flash,
    underline,
    selection,
    textLayer: null,
    builder: null,
    page: null,
    pageHeightPx: 0,
    cropTopPx: 0,
  };
}

// The text bounding box of a page in page fractions (0..1), or null if unknown.
function textBounds(
  geom: PageGeometry | null | undefined,
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  if (!geom || geom.runs.length === 0) return null;
  return {
    minX: Math.min(...geom.runs.map((r) => r.x)),
    maxX: Math.max(...geom.runs.map((r) => r.x + r.width)),
    minY: Math.min(...geom.runs.map((r) => r.y)),
    maxY: Math.max(...geom.runs.map((r) => r.y + r.height)),
  };
}

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

function px(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pdfSnapshotDataUrl(canvas: HTMLCanvasElement): string {
  const webp = canvas.toDataURL("image/webp", 0.82);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
}

function setCanvasCssSize(canvas: HTMLCanvasElement, width: number, height: number): void {
  canvas.style.cssText = `width:${width}px;height:${height}px;`;
}

function capturePdfSnapshot(
  sourceId: string,
  scroller: HTMLDivElement,
  panes: Pane[],
  location: SourceLocation,
): RenderSnapshot | null {
  const wrap = wrapRefFromScroller(scroller);
  if (!wrap) return null;
  const width = Math.ceil(scroller.clientWidth);
  const height = Math.ceil(scroller.clientHeight);
  if (width <= 0 || height <= 0 || panes.length === 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);

  for (const pane of panes) {
    if (pane.page === null || pane.canvas.width <= 0 || pane.canvas.height <= 0) continue;
    const paneWidth = pane.el.offsetWidth;
    const paneHeight = pane.el.offsetHeight;
    if (paneWidth <= 0 || paneHeight <= 0) continue;

    const pageWidth = px(pane.canvas.style.width) || paneWidth;
    const pageHeight = px(pane.canvas.style.height) || paneHeight;
    const scaleX = pane.canvas.width / pageWidth;
    const scaleY = pane.canvas.height / pageHeight;
    const sx = -px(pane.inner.style.left) * scaleX;
    const sy = -px(pane.inner.style.top) * scaleY;
    const sw = paneWidth * scaleX;
    const sh = paneHeight * scaleY;
    ctx.drawImage(
      pane.canvas,
      sx,
      sy,
      sw,
      sh,
      wrap.offsetLeft + pane.el.offsetLeft - scroller.scrollLeft,
      wrap.offsetTop + pane.el.offsetTop - scroller.scrollTop,
      paneWidth,
      paneHeight,
    );
  }

  return {
    sourceId,
    kind: "pdf",
    locationKey: `pdf:${location.page}:${location.total}:${width}x${height}`,
    width,
    height,
    dataUrl: pdfSnapshotDataUrl(canvas),
    capturedAt: Date.now(),
  };
}

function wrapRefFromScroller(scroller: HTMLDivElement): HTMLDivElement | null {
  const first = scroller.firstElementChild;
  return first instanceof HTMLDivElement ? first : null;
}

function pdfRenderCacheKey(sourceId: string | null, file: File | null): string | null {
  return sourceId && file ? `${sourceId}:${file.name}:${file.size}:${file.lastModified}` : null;
}

interface CapturedPdfSnapshot {
  sourceId: string | null;
  snapshot: RenderSnapshot | null;
}

interface PdfViewState {
  ready: boolean;
  title: string | null;
  location: SourceLocation | null;
  position: SourceReadingPosition | null;
  selection: { x: number; y: number } | null;
  capturedSnapshot: CapturedPdfSnapshot;
}

type PdfViewAction =
  | { type: "reset"; sourceId: string | null }
  | { type: "ready"; ready: boolean }
  | { type: "title"; title: string | null }
  | { type: "location"; location: SourceLocation | null }
  | { type: "position"; position: SourceReadingPosition | null }
  | { type: "selection"; selection: { x: number; y: number } | null }
  | { type: "capturedSnapshot"; sourceId: string | null; snapshot: RenderSnapshot | null };

function pdfViewReducer(state: PdfViewState, action: PdfViewAction): PdfViewState {
  switch (action.type) {
    case "reset":
      return {
        ready: false,
        title: null,
        location: null,
        position: null,
        selection: null,
        capturedSnapshot: { sourceId: action.sourceId, snapshot: null },
      };
    case "ready":
      return { ...state, ready: action.ready };
    case "title":
      return { ...state, title: action.title };
    case "location":
      return { ...state, location: action.location };
    case "position":
      return { ...state, position: action.position };
    case "selection":
      return { ...state, selection: action.selection };
    case "capturedSnapshot":
      return {
        ...state,
        capturedSnapshot: { sourceId: action.sourceId, snapshot: action.snapshot },
      };
  }
}

export function usePdfSourceView(
  sourceId: string | null,
  file: File | null,
  onSelect: OnSelect,
  onSearchHighlightCleared?: () => void,
  initialPosition?: SourceReadingPosition | null,
): SourceView {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const { smartArrows, pdfPageLayout } = useReaderPrefs();
  const smartArrowsRef = useRef(smartArrows);
  smartArrowsRef.current = smartArrows;
  const pageLayoutRef = useRef(pdfPageLayout);
  pageLayoutRef.current = pdfPageLayout;

  const [fontSize, setFontSizeState] = useState(100);
  const [viewState, dispatchView] = useReducer(pdfViewReducer, {
    ready: false,
    title: null,
    location: null,
    position: null,
    selection: null,
    capturedSnapshot: { sourceId, snapshot: null },
  });
  const { ready, title, location, position, selection, capturedSnapshot } = viewState;
  const snapshot = useMemo<RenderSnapshot | null>(() => {
    if (capturedSnapshot.sourceId === sourceId && capturedSnapshot.snapshot) {
      return capturedSnapshot.snapshot;
    }
    return getRenderSnapshot(sourceId);
  }, [capturedSnapshot, sourceId]);

  const docRef = useRef<PDFDocumentProxy | null>(null);
  const pageRef = useRef(1);
  const fontSizeRef = useRef(100);
  fontSizeRef.current = fontSize;
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Up to two page panes (the current spread). pageRef holds the *left* page.
  const panesRef = useRef<Pane[]>([]);
  const spreadActiveRef = useRef(false);
  const geometryRef = useRef<Map<number, PageGeometry>>(null!);
  geometryRef.current ??= new Map<number, PageGeometry>();
  const drawnRef = useRef<Map<string, Drawn>>(null!);
  drawnRef.current ??= new Map<string, Drawn>();
  const underlineRef = useRef<HighlightAnchor | null>(null);
  const pendingRef = useRef<{ anchor: HighlightAnchor; range: Range; clear: () => void } | null>(
    null,
  );
  const renderSeqRef = useRef(0);
  const initialPdfPage = initialPosition?.kind === "pdf" ? initialPosition.page : null;
  // The cross-navigation PDF document cache keeps a `PDFDocumentProxy` (and its
  // pdf.js worker) alive after the reader unmounts, so revisiting a book skips
  // the reparse. On mobile that backfires: the OS reclaims the backgrounded
  // worker's memory, and the next `getPage`/`render` RPC to the dead worker
  // never resolves — the reader hangs forever on what should be a cached open.
  // A null key disables both the cache read and write *and* makes cleanup
  // always destroy the doc, restoring the pre-cache behavior (fresh load + fresh
  // worker every open). Reparsing on mobile costs little next to a hang.
  const renderCacheKey = isMobileViewport() ? null : pdfRenderCacheKey(sourceId, file);
  const [openedSource, setOpenedSource] = useState({ file, initialPdfPage, sourceId });

  if (
    openedSource.file !== file ||
    openedSource.initialPdfPage !== initialPdfPage ||
    openedSource.sourceId !== sourceId
  ) {
    setOpenedSource({ file, initialPdfPage, sourceId });
    dispatchView({ type: "reset", sourceId });
    geometryRef.current.clear();
    drawnRef.current.clear();
    underlineRef.current = null;
    pageRef.current = initialPdfPage === null ? 1 : Math.max(1, Math.round(initialPdfPage));
  }

  const geometryFor = useCallback(async (pageNum: number): Promise<PageGeometry | null> => {
    const doc = docRef.current;
    if (!doc || pageNum < 1 || pageNum > doc.numPages) return null;
    const cached = geometryRef.current.get(pageNum);
    if (cached) return cached;
    const geom = await pageGeometry(await doc.getPage(pageNum));
    geometryRef.current.set(pageNum, geom);
    return geom;
  }, []);

  // A two-page spread is only worth showing when the user opted in ("auto"),
  // the document has at least two pages, and the viewport is wide enough that
  // each page still clears a comfortable minimum width. Otherwise: single page.
  const computeSpreadEnabled = useCallback((): boolean => {
    const doc = docRef.current;
    const scroller = scrollerRef.current;
    if (!doc || !scroller) return false;
    return spreadFits(pageLayoutRef.current, doc.numPages, scroller.clientWidth);
  }, []);

  const ensurePanes = useCallback((count: number): Pane[] => {
    const wrap = wrapRef.current;
    const panes = panesRef.current;
    if (!wrap) return panes;
    while (panes.length < count) {
      const pane = createPane();
      panes.push(pane);
      wrap.appendChild(pane.el);
    }
    while (panes.length > count) {
      const pane = panes.pop();
      pane?.builder?.cancel();
      pane?.el.remove();
    }
    return panes;
  }, []);

  // Vertical text bounds across the visible spread (union of all panes' text),
  // so smart-arrow scrolling and fit reuse the same top/bottom detection.
  const scrollBounds = useCallback((): { floor: number; ceil: number } => {
    const scroller = scrollerRef.current;
    if (!scroller) return { floor: 0, ceil: 0 };
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    let minTop = Infinity;
    let maxBottom = -Infinity;
    for (const pane of panesRef.current) {
      if (pane.page === null) continue;
      const geom = geometryRef.current.get(pane.page);
      if (!geom || geom.runs.length === 0) continue;
      // Text lives in full-page coordinates inside `inner`; map to scroller
      // content space via the pane's position and crop offset.
      const offset = pane.el.offsetTop - pane.cropTopPx;
      const ph = pane.pageHeightPx;
      minTop = Math.min(minTop, offset + Math.min(...geom.runs.map((run) => run.y)) * ph);
      maxBottom = Math.max(
        maxBottom,
        offset + Math.max(...geom.runs.map((run) => run.y + run.height)) * ph,
      );
    }
    if (minTop === Infinity) return { floor: 0, ceil: maxScroll };
    const floor = Math.min(maxScroll, Math.max(0, minTop - READER_NAV.textTopMargin));
    const ceil = Math.max(
      floor,
      Math.min(maxScroll, maxBottom + READER_NAV.textTopMargin - scroller.clientHeight),
    );
    return { floor, ceil };
  }, []);

  const scrollToTextTop = useCallback(async (): Promise<void> => {
    const doc = docRef.current;
    const left = pageRef.current;
    await Promise.all(
      spreadPages(left, spreadActiveRef.current, doc?.numPages ?? left).map((p) => geometryFor(p)),
    );
    const scroller = scrollerRef.current;
    if (!scroller || left !== pageRef.current) return;
    scroller.scrollTop = scrollBounds().floor;
  }, [geometryFor, scrollBounds]);

  const publishPosition = useCallback((): void => {
    const doc = docRef.current;
    const scroller = scrollerRef.current;
    if (!doc || !scroller) return;
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const scrollRatio = maxScroll > 0 ? scroller.scrollTop / maxScroll : 0;
    dispatchView({
      type: "position",
      position: {
        kind: "pdf",
        page: pageRef.current,
        scrollRatio: Math.min(1, Math.max(0, scrollRatio)),
        zoom: fontSizeRef.current,
        percentage: doc.numPages > 0 ? (pageRef.current - 1 + scrollRatio) / doc.numPages : 0,
      },
    });
  }, []);

  const scrollToAnchor = useCallback(
    async (anchor: HighlightAnchor): Promise<void> => {
      if (anchor.kind !== "pdf-text" || anchor.rects.length === 0) return;
      await geometryFor(anchor.page);
      const scroller = scrollerRef.current;
      const pane = panesRef.current.find((p) => p.page === anchor.page);
      if (!scroller || !pane) return;
      const offset = pane.el.offsetTop - pane.cropTopPx;
      const top = offset + Math.min(...anchor.rects.map((r) => r.y)) * pane.pageHeightPx;
      const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const target = Math.min(maxScroll, Math.max(0, top - READER_NAV.textTopMargin));
      scroller.scrollTop = target;
    },
    [geometryFor],
  );

  const paneForPage = (page: number): Pane | null =>
    panesRef.current.find((p) => p.page === page) ?? null;

  const paintRectsInto = (
    layer: HTMLDivElement,
    id: string,
    anchor: HighlightAnchor,
    cls: string,
  ): HTMLDivElement[] => {
    const painted: HTMLDivElement[] = [];
    if (anchor.kind !== "pdf-text") return painted;
    const { clientWidth: w, clientHeight: h } = layer;
    for (const rect of anchor.rects) {
      const div = document.createElement("div");
      div.className = cls;
      div.dataset.hid = id;
      div.style.cssText = `position:absolute;left:${rect.x * w}px;top:${
        rect.y * h + PDF_RECT_Y_NUDGE_PX
      }px;width:${rect.width * w}px;height:${rect.height * h}px;${
        cls === "bc-highlight" ? "cursor:pointer;" : ""
      }`;
      if (cls === "bc-highlight") {
        div.addEventListener("click", () => drawnRef.current.get(id)?.onClick());
      }
      layer.appendChild(div);
      painted.push(div);
    }
    return painted;
  };

  // Paint an anchor into the pane that currently shows its page (if visible).
  const paintAnchor = (
    layerKey: PaneLayerKey,
    id: string,
    anchor: HighlightAnchor,
    cls: string,
  ): HTMLDivElement[] => {
    if (anchor.kind !== "pdf-text") return [];
    const pane = paneForPage(anchor.page);
    if (!pane) return [];
    return paintRectsInto(pane[layerKey], id, anchor, cls);
  };

  const repaintHighlights = useCallback(() => {
    for (const pane of panesRef.current) pane.highlight.replaceChildren();
    for (const [id, { anchor }] of drawnRef.current)
      paintAnchor("highlight", id, anchor, "bc-highlight");
  }, []);

  const repaintUnderline = useCallback(() => {
    for (const pane of panesRef.current) pane.underline.replaceChildren();
    if (underlineRef.current) paintAnchor("underline", "search", underlineRef.current, "bc-search");
  }, []);

  // Live preview of the in-progress selection. Native ::selection is rendered
  // transparent (see reader.css), because pdf.js's absolutely-positioned text
  // spans don't follow visual order — so the browser paints stray selection
  // rectangles in the margins. We instead paint the same word-confined rects we
  // capture for the eventual highlight, so the preview matches the saved result.
  const repaintSelection = useCallback(() => {
    for (const pane of panesRef.current) pane.selection.replaceChildren();
    const pending = pendingRef.current;
    if (pending) paintAnchor("selection", "selection", pending.anchor, "bc-selection");
  }, []);

  const clearFlash = useCallback(() => {
    for (const pane of panesRef.current) pane.flash.replaceChildren();
  }, []);

  const flashHighlight = useCallback(
    (anchor: HighlightAnchor) => {
      clearFlash();
      const [first] = paintAnchor("flash", "jump", anchor, "bc-jump-flash");
      first?.addEventListener("animationend", clearFlash, { once: true });
    },
    [clearFlash],
  );

  // Build (but do not display) the text layer for a page, then swap it into the
  // pane once ready. Lives in a separate dynamically-imported chunk
  // (pdf_viewer.mjs); if it 404/403s on a deploy the page must still be fully
  // usable for viewing/zoom/paging — selection and in-page search are the only
  // casualties — so failures here are swallowed and never propagate.
  const renderTextLayerInto = useCallback(
    async (pane: Pane, page: PDFPageProxy, viewport: unknown, seq: number) => {
      try {
        if (seq !== renderSeqRef.current) return;
        const TextLayerBuilderCtor = await loadTextLayerBuilderCtor();
        if (seq !== renderSeqRef.current) return;
        const builder = new TextLayerBuilderCtor({ pdfPage: page });
        await builder.render({ viewport } as Parameters<typeof builder.render>[0]);
        if (seq !== renderSeqRef.current || !panesRef.current.includes(pane)) {
          builder.cancel();
          builder.div.remove();
          return;
        }
        pane.builder?.cancel();
        pane.builder?.div.remove();
        pane.builder = builder;
        pane.textLayer = builder.div;
        pane.inner.appendChild(builder.div);
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
  // Render the current spread (1–2 pages). pageRef holds the left page; it is
  // normalised here to the spread's left page so a turn that lands mid-pair
  // snaps to the correct book opening. `doubleBuffer` renders each page's new
  // scale into a *detached* canvas and swaps it in only once fully painted,
  // instead of resizing/blanking the on-screen canvas in place — used for the
  // pinch commit so the live (CSS-scaled) page stays untouched until the crisp
  // bitmap is ready (no flash). The in-place path keeps +/- and page turns
  // resizing the box immediately, so scroll/scrollHeight math stays correct.
  const renderSpread = useCallback(
    async (opts?: { doubleBuffer?: boolean }) => {
      const doc = docRef.current;
      const wrap = wrapRef.current;
      if (!doc || !wrap) return;

      const seq = ++renderSeqRef.current;
      const enabled = computeSpreadEnabled();
      spreadActiveRef.current = enabled;
      const left = spreadStart(pageRef.current, enabled);
      pageRef.current = left;
      const pages = spreadPages(left, enabled, doc.numPages);
      const panes = ensurePanes(pages.length);

      const dpr = Math.min(window.devicePixelRatio || 1, READER_NAV.maxRenderDpr);
      const gutter = pages.length > 1 ? READER_NAV.spreadGutterPx : 0;
      const pad = READER_NAV.spreadCropPadPx;
      if (seq !== renderSeqRef.current) return;
      const leftPage = await doc.getPage(pages[0]!);
      if (seq !== renderSeqRef.current) return;
      const leftBase = leftPage.getViewport({ scale: 1 });
      const parentW = wrap.parentElement?.clientWidth ?? leftBase.width;
      // At 100% the whole spread (both pages + gutter) fits the viewport width.
      const fit =
        pages.length > 1 ? (parentW - gutter) / (2 * leftBase.width) : parentW / leftBase.width;
      const scale = fit * (fontSizeRef.current / 100);
      // The text-layer spans size their glyphs off these CSS vars (inherited).
      wrap.style.setProperty("--pdf-spread-gutter", `${gutter}px`);
      wrap.style.setProperty("--total-scale-factor", String(scale));
      wrap.style.setProperty("--scale-factor", String(scale));

      // In a spread, crop each page to its text box so the inner page margins
      // (which would otherwise leave a wide gap between the pages and tall empty
      // bands above/below) disappear. Vertical crop is the union across both
      // pages so they stay aligned; horizontal crop is per page.
      const boundsByPage = new Map<number, ReturnType<typeof textBounds>>();
      let unionMinY = Infinity;
      let unionMaxY = -Infinity;
      if (enabled) {
        if (seq !== renderSeqRef.current) return;
        const spreadBounds = await Promise.all(
          pages.map(async (pageNum) => ({
            pageNum,
            bounds: textBounds(await geometryFor(pageNum)),
          })),
        );
        if (seq !== renderSeqRef.current) return;
        for (const { pageNum, bounds } of spreadBounds) {
          boundsByPage.set(pageNum, bounds);
          if (bounds) {
            unionMinY = Math.min(unionMinY, bounds.minY);
            unionMaxY = Math.max(unionMaxY, bounds.maxY);
          }
        }
      }
      const hasVerticalCrop = enabled && unionMinY !== Infinity;

      if (seq !== renderSeqRef.current) return;
      const pageEntries = await Promise.all(
        pages.map(async (pageNum, index) => ({
          index,
          pageNum,
          page: index === 0 ? leftPage : await doc.getPage(pageNum),
        })),
      );
      if (seq !== renderSeqRef.current) return;
      const renderedPanes = [];
      for (const { index, pageNum, page } of pageEntries) {
        const pane = panes[index]!;
        const viewport = page.getViewport({ scale });
        const pageW = viewport.width;
        const pageH = viewport.height;
        pane.page = pageNum;

        // Crop rect (CSS px within the full page). Horizontal: this page's text;
        // vertical: the shared union so both panes align.
        const hb = boundsByPage.get(pageNum);
        const crop = cropBox(
          enabled ? (hb ?? null) : null,
          hasVerticalCrop ? { minY: unionMinY, maxY: unionMaxY } : null,
          pageW,
          pageH,
          pad,
        );

        // `inner` holds the full page in page coordinates; offset it so only the
        // crop region shows through `el` (which has overflow: hidden).
        const applyLayout = () => {
          pane.inner.style.width = `${pageW}px`;
          pane.inner.style.height = `${pageH}px`;
          pane.inner.style.left = `${-crop.left}px`;
          pane.inner.style.top = `${-crop.top}px`;
          pane.el.style.width = `${crop.width}px`;
          pane.el.style.height = `${crop.height}px`;
          pane.pageHeightPx = pageH;
          pane.cropTopPx = crop.top;
        };

        if (opts?.doubleBuffer) {
          const next = document.createElement("canvas");
          next.width = Math.floor(pageW * dpr);
          next.height = Math.floor(pageH * dpr);
          setCanvasCssSize(next, pageW, pageH);
          const ctx = next.getContext("2d");
          if (!ctx) return;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          if (seq !== renderSeqRef.current) return;
          await page.render({ canvas: next, canvasContext: ctx, viewport }).promise;
          if (seq !== renderSeqRef.current) return;
          renderedPanes.push({
            width: crop.width,
            height: crop.height,
            commit: () => {
              const prev = pane.canvas;
              if (prev.parentNode === pane.inner) pane.inner.replaceChild(next, prev);
              else pane.inner.insertBefore(next, pane.inner.firstChild);
              prev.width = prev.height = 0; // release the old backing store (iOS canvas memory).
              pane.canvas = next;
              applyLayout();
            },
          });
          continue;
        }
        const canvas = pane.canvas;
        canvas.width = Math.floor(pageW * dpr);
        canvas.height = Math.floor(pageH * dpr);
        setCanvasCssSize(canvas, pageW, pageH);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (seq !== renderSeqRef.current) return;
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        if (seq !== renderSeqRef.current) return;
        renderedPanes.push({ width: crop.width, height: crop.height, commit: applyLayout });
      }
      if (seq !== renderSeqRef.current) return;
      let totalWidth = 0;
      let maxHeight = 0;
      for (const rendered of renderedPanes) {
        if (!rendered) return;
        totalWidth += rendered.width;
        maxHeight = Math.max(maxHeight, rendered.height);
        rendered.commit();
      }
      // Explicit row size so `margin: 0 auto` centers the spread in the scroller.
      wrap.style.width = `${totalWidth + gutter}px`;
      wrap.style.height = `${maxHeight}px`;

      repaintHighlights();
      repaintUnderline();
      repaintSelection();
      const lastPage = pages.at(-1)!;
      const nextLocation: SourceLocation = {
        page: left,
        total: doc.numPages,
        percentage: doc.numPages > 0 ? left / doc.numPages : 0,
        atStart: left <= 1,
        atEnd: lastPage >= doc.numPages,
      };
      dispatchView({ type: "location", location: nextLocation });
      publishPosition();
      // Snapshotting paints the whole spread into an offscreen canvas and
      // `toDataURL`-encodes it (WebP/PNG) on every render — a synchronous
      // main-thread cost that's punishing on mobile, where it runs on each page
      // turn, zoom, and resize. Its only payoff is an instant placeholder when
      // re-opening a book, which matters far less on mobile (slower, less book
      // hopping), so we skip capture there and fall back to the loading spinner.
      if (sourceId && !isMobileViewport()) {
        const scroller = scrollerRef.current;
        const nextSnapshot = scroller
          ? capturePdfSnapshot(sourceId, scroller, panes, nextLocation)
          : null;
        if (nextSnapshot) {
          putRenderSnapshot(nextSnapshot);
          dispatchView({ type: "capturedSnapshot", sourceId, snapshot: nextSnapshot });
        }
      }

      // Fire-and-forget so renderSpread resolves at the swap (see above).
      for (const [index, pageNum] of pages.entries()) {
        const pane = panes[index]!;
        void doc
          .getPage(pageNum)
          .then((page) => renderTextLayerInto(pane, page, page.getViewport({ scale }), seq));
      }
    },
    [
      computeSpreadEnabled,
      ensurePanes,
      geometryFor,
      repaintHighlights,
      repaintUnderline,
      repaintSelection,
      publishPosition,
      renderTextLayerInto,
      sourceId,
    ],
  );

  // Latest renderSpread for use inside imperative touch handlers without making
  // the pinch effect re-subscribe on every renderSpread identity change.
  const renderPageRef = useRef(renderSpread);
  renderPageRef.current = renderSpread;

  const goToPage = useCallback(
    async (
      pageNum: number,
      afterRender: () => Promise<void> = () => Promise.resolve(),
    ): Promise<void> => {
      const doc = docRef.current;
      if (!doc) return;
      const enabled = computeSpreadEnabled();
      const clamped = Math.min(Math.max(1, pageNum), doc.numPages);
      const left = spreadStart(clamped, enabled);
      if (left === pageRef.current && location) {
        await afterRender();
        return;
      }
      pageRef.current = left;
      dispatchView({ type: "selection", selection: null });
      pendingRef.current = null;
      repaintSelection();
      clearFlash();
      // Land at the top of the freshly-entered spread.
      if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
      // Double-buffer so the outgoing spread stays painted until the new one is
      // ready, and both pages flip together (no per-pane flicker on the right).
      await renderSpread({ doubleBuffer: true });
      await afterRender();
      publishPosition();
    },
    [renderSpread, computeSpreadEnabled, location, clearFlash, repaintSelection, publishPosition],
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

    const scroller = document.createElement("div");
    scroller.className = "pdf-scroller";
    // `wrap` is the spread row; the page panes (canvas + overlays + text layer)
    // are created and managed per-render by ensurePanes / renderSpread.
    const wrap = document.createElement("div");
    wrap.className = "pdf-page";
    wrap.style.position = "relative";
    wrap.style.margin = "0 auto";
    scroller.appendChild(wrap);
    host.appendChild(scroller);
    scrollerRef.current = scroller;
    wrapRef.current = wrap;
    panesRef.current = [];

    const fiber = Effect.runFork(
      Effect.gen(function* () {
        const doc = yield* Effect.promise(async () => {
          const cached = renderCacheKey ? getCachedPdfDocument(renderCacheKey) : null;
          if (cached) {
            docRef.current = cached;
            return cached;
          }
          const buffer = await file.arrayBuffer();
          const loaded = await loadPdf(buffer);
          if (renderCacheKey) putCachedPdfDocument(renderCacheKey, loaded, buffer.byteLength);
          docRef.current = loaded;
          return loaded;
        });
        const meta = yield* Effect.promise(() => doc.getMetadata().catch(() => null));
        const info = meta?.info as { Title?: string } | undefined;
        dispatchView({ type: "title", title: info?.Title?.trim() || null });
        if (initialPdfPage !== null) {
          pageRef.current = Math.min(Math.max(1, pageRef.current), doc.numPages);
        }
        // Land on the saved page (already applied to pageRef above), but always
        // frame it to fit the viewport — opening or swapping books resets the
        // zoom to fit-to-page rather than restoring a stale zoom/scroll. We
        // compute the fit zoom *before* the first raster (it only needs page
        // geometry, no canvas) and render once at that zoom; previously we
        // rendered at 100% and then re-rendered at the fit zoom, paying for two
        // full canvas paints + text-layer builds on every open — costly on
        // mobile. A scanned page (no text) yields a null fit and opens at 100%.
        spreadActiveRef.current = computeSpreadEnabled();
        const fitZoom = yield* Effect.promise(() => computeFitZoomRef.current());
        if (fitZoom !== null) {
          setFontSizeState(fitZoom);
          fontSizeRef.current = fitZoom;
        }
        yield* Effect.promise(() => renderSpread());
        yield* Effect.promise(() => scrollToTextTop());
        dispatchView({ type: "ready", ready: true });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => console.error("failed to open pdf", Cause.pretty(cause))),
        ),
      ),
    );

    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
      bumpSeq(renderSeqRef);
      clearFlash();
      for (const pane of panesRef.current) pane.builder?.cancel();
      panesRef.current = [];
      const doc = docRef.current;
      docRef.current = null;
      if (doc && (!renderCacheKey || !hasCachedPdfDocument(renderCacheKey, doc)))
        void destroyPdf(doc);
      scroller.remove();
      scrollerRef.current = null;
      wrapRef.current = null;
      dispatchView({ type: "ready", ready: false });
    };
  }, [
    file,
    sourceId,
    renderCacheKey,
    renderSpread,
    clearFlash,
    initialPdfPage,
    computeSpreadEnabled,
    scrollToTextTop,
  ]);

  // Re-render when the page-layout preference changes (single ⇄ two-page),
  // preserving the current spread's left page, then fit the new layout to the
  // page. Skipped on mount / ready flips. `fitToTextRef` is read lazily (the
  // callback is defined below) so the dependency list stays minimal.
  const fitToTextRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const prevLayoutRef = useRef(pdfPageLayout);
  useEffect(() => {
    if (!ready) {
      prevLayoutRef.current = pdfPageLayout;
      return;
    }
    if (prevLayoutRef.current === pdfPageLayout) return;
    prevLayoutRef.current = pdfPageLayout;
    void (async () => {
      await renderSpread();
      await fitToTextRef.current();
    })();
  }, [pdfPageLayout, ready, renderSpread]);

  // A width change can cross the spread-fits threshold, so re-render on resize
  // (preserving scroll ratio) instead of leaving stale page sizing in place.
  useEffect(() => {
    if (!ready) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let raf = 0;
    let lastWidth = scroller.clientWidth;
    const observer = new ResizeObserver(() => {
      const width = scroller.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const ratio = maxScroll > 0 ? scroller.scrollTop / maxScroll : 0;
        // Did this width change cross the single ⇄ two-page threshold? If so the
        // layout fundamentally changed, so re-fit the page rather than trying to
        // preserve the old scroll position.
        const flipped = computeSpreadEnabled() !== spreadActiveRef.current;
        // Double-buffer so the live page stays painted until the resized one is
        // ready — avoids the blank-canvas flash on each step of a slow drag.
        void renderPageRef.current({ doubleBuffer: true }).then(() => {
          if (flipped) {
            void fitToTextRef.current();
            return;
          }
          const newMax = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
          scroller.scrollTop = ratio * newMax;
        });
      });
    });
    observer.observe(scroller);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [ready, computeSpreadEnabled]);

  useEffect(() => {
    const clear = () => {
      if (!pendingRef.current) return;
      pendingRef.current = null;
      repaintSelection();
      dispatchView({ type: "selection", selection: null });
    };
    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return clear();
      const raw = sel.getRangeAt(0);
      // Find which page pane the selection lives in (a selection never spans the
      // gutter — the pane whose text layer the range intersects owns it), so the
      // captured rects stay relative to that one page's box.
      const pane = panesRef.current.find(
        (p) => p.textLayer !== null && raw.intersectsNode(p.textLayer),
      );
      if (!pane || !pane.textLayer || pane.page === null) return;
      const range = expandToWordBoundaries(raw);

      const domRects = textClientRects(range, pane.textLayer);
      if (domRects.length === 0) return;
      // Fractions are relative to the full-page box (`inner`), not the crop
      // viewport (`el`), so anchors stay page-relative regardless of cropping.
      const box = pane.inner.getBoundingClientRect();
      const rects: PdfRect[] = domRects.map((r) => ({
        x: (r.left - box.left) / box.width,
        y: (r.top - box.top) / box.height,
        width: r.width / box.width,
        height: r.height / box.height,
      }));
      pendingRef.current = {
        anchor: pdfAnchor(pane.page, rects),
        range,
        clear: () => sel.removeAllRanges(),
      };
      repaintSelection();
      dispatchView({ type: "selection", selection: popupPoint(boundingRect(domRects)) });
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [repaintSelection]);

  // Zoom anchored to the viewport center, so the +/- buttons keep the framing
  // (a two-page spread stays centered instead of sliding off to the left).
  const setFontSize = useCallback(
    (pct: number) => {
      const clamped = Math.min(READER_NAV.maxZoom, Math.max(READER_NAV.minZoom, Math.round(pct)));
      if (clamped === fontSizeRef.current) return;
      const scroller = scrollerRef.current;
      const wrap = wrapRef.current;
      let frac = { fracX: 0.5, fracY: 0.5 };
      let cx = 0;
      let cy = 0;
      if (scroller && wrap) {
        cx = scroller.clientWidth / 2;
        cy = scroller.clientHeight / 2;
        const sRect = scroller.getBoundingClientRect();
        frac = focalFraction(wrap, sRect.left + cx, sRect.top + cy);
      }
      setFontSizeState(clamped);
      fontSizeRef.current = clamped;
      void renderSpread().then(() => {
        if (!scroller || !wrap) return;
        scrollToFocalFraction(scroller, wrap, frac.fracX, frac.fracY, cx, cy);
      });
    },
    [renderSpread],
  );

  // Zoom so the current spread's text fills the viewport: as large as possible
  // while the whole spread (both pages + gutter) still fits the viewport width
  // (no horizontal scroll) and the tallest page's text fits the viewport height,
  // leaving a slight margin. Reuses the same text top/bottom detection (geometry
  // runs) that drives smart-arrow scrolling, so it tracks the real text.
  // Compute the fit-to-page zoom without rendering, so the open path can
  // rasterize the page once at its final zoom (rather than rendering at 100%
  // and immediately re-rendering at the fit zoom). Returns null when there's
  // nothing to fit (no doc/scroller, page changed mid-flight, or a scanned page
  // with no text), in which case callers keep the current zoom.
  const computeFitZoom = useCallback(async (): Promise<number | null> => {
    const doc = docRef.current;
    const scroller = scrollerRef.current;
    if (!doc || !scroller) return null;
    const enabled = spreadActiveRef.current;
    const left = pageRef.current;
    const pages = spreadPages(left, enabled, doc.numPages);
    if (left !== pageRef.current) return null;
    const pageData = await Promise.all(
      pages.map(async (pageNum) => {
        const page = await doc.getPage(pageNum);
        const base = page.getViewport({ scale: 1 });
        const geom = await geometryFor(pageNum);
        return { pageNum, base, bounds: textBounds(geom) };
      }),
    );
    if (left !== pageRef.current || pageData.length === 0) return null;
    const leftBase = pageData[0]!.base;

    // When spread is active, pages are cropped to their text, so fit against the
    // combined *text* width; in single-page mode, fit against the full page
    // width (it is not cropped).
    let combinedWidth = 0;
    // Height fits the *union* of both pages' vertical text extents — the same
    // span renderSpread crops to and scrollBounds measures. Fitting only the
    // taller single page would zoom in too far when the pages' text sits in
    // different bands, so the union overflows and smart-scroll keeps scrolling.
    let unionMinY = Infinity;
    let unionMaxY = -Infinity;
    let maxBaseHeight = 0;
    let anyText = false;
    for (const { base, bounds } of pageData) {
      maxBaseHeight = Math.max(maxBaseHeight, base.height);
      if (left !== pageRef.current) return null;
      if (bounds) {
        anyText = true;
        combinedWidth += enabled ? (bounds.maxX - bounds.minX) * base.width : base.width;
        unionMinY = Math.min(unionMinY, bounds.minY);
        unionMaxY = Math.max(unionMaxY, bounds.maxY);
      } else {
        combinedWidth += base.width; // scanned page: fall back to its full width.
      }
    }
    if (!anyText || left !== pageRef.current) return null;
    const textHeight = (unionMaxY - unionMinY) * maxBaseHeight;

    const margin = READER_NAV.textTopMargin;
    const gutter = pages.length > 1 ? READER_NAV.spreadGutterPx : 0;
    const pad = enabled ? READER_NAV.spreadCropPadPx : 0;
    const fit =
      pages.length > 1
        ? (scroller.clientWidth - gutter) / (2 * leftBase.width)
        : scroller.clientWidth / leftBase.width;
    const widthBudget = scroller.clientWidth - gutter - 2 * margin - pages.length * 2 * pad;
    const widthScale = Math.max(1, widthBudget) / combinedWidth;
    const heightScale = Math.max(1, scroller.clientHeight - 2 * margin - 2 * pad) / textHeight;
    const scale = Math.min(widthScale, heightScale);
    // Floor (not round) the zoom so fit never lands *above* the computed scale —
    // rounding up would make the text a hair taller than the viewport budget,
    // leaving scrollBounds with a sliver of scroll range and triggering smart
    // scroll right after a fit (most visible in single-page mode, which has no
    // crop pad to absorb the overshoot).
    return Math.min(
      READER_NAV.maxZoom,
      Math.max(READER_NAV.minZoom, Math.floor((scale / fit) * 100)),
    );
  }, [geometryFor]);
  const computeFitZoomRef = useRef(computeFitZoom);
  computeFitZoomRef.current = computeFitZoom;

  const fitToText = useCallback(async (): Promise<void> => {
    const clamped = await computeFitZoom();
    if (clamped !== null && clamped !== fontSizeRef.current) {
      setFontSizeState(clamped);
      fontSizeRef.current = clamped;
      await renderSpread();
    }
    await scrollToTextTop();
  }, [computeFitZoom, renderSpread, scrollToTextTop]);
  fitToTextRef.current = fitToText;
  const next = useCallback(() => {
    if (scrollWithinPage("down")) return;
    const numPages = docRef.current?.numPages ?? pageRef.current;
    void goToPage(spreadEnd(pageRef.current, spreadActiveRef.current, numPages) + 1);
  }, [scrollWithinPage, goToPage]);
  const prev = useCallback(() => {
    if (scrollWithinPage("up")) return;
    void goToPage(spreadStart(pageRef.current, spreadActiveRef.current) - 1);
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
    repaintSelection();
    dispatchView({ type: "selection", selection: null });
  }, [repaintSelection]);
  const commitSelection = useCallback(
    (intent: SelectIntent = "note") => {
      const pending = pendingRef.current;
      if (pending) onSelectRef.current(pending.anchor, pending.range, intent);
      dismissSelection();
    },
    [dismissSelection],
  );

  useEffect(() => {
    if (!ready) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const onScroll = () => publishPosition();
    // Trackpad pinch / ctrl+wheel zoom, anchored to the cursor: capture the
    // content point under the pointer, re-render at the new zoom, then fix the
    // scroll so that same point stays under the cursor.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // a real scroll, leave it to the container
      e.preventDefault();
      const wrap = wrapRef.current;
      const target = Math.min(
        READER_NAV.maxZoom,
        Math.max(
          READER_NAV.minZoom,
          Math.round(fontSizeRef.current * (1 - e.deltaY * READER_NAV.pinchWheelSensitivity)),
        ),
      );
      if (target === fontSizeRef.current || !wrap) return;
      const sRect = scroller.getBoundingClientRect();
      const cx = e.clientX - sRect.left;
      const cy = e.clientY - sRect.top;
      const { fracX, fracY } = focalFraction(wrap, e.clientX, e.clientY);
      setFontSizeState(target);
      fontSizeRef.current = target;
      void renderPageRef.current().then(() => {
        scrollToFocalFraction(scroller, wrap, fracX, fracY, cx, cy);
      });
    };
    const dist = (t: TouchList) =>
      Math.hypot(
        (t[0]?.clientX ?? 0) - (t[1]?.clientX ?? 0),
        (t[0]?.clientY ?? 0) - (t[1]?.clientY ?? 0),
      );
    const clampZoom = (z: number) => Math.min(READER_NAV.maxZoom, Math.max(READER_NAV.minZoom, z));
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
      scrollToFocalFraction(scroller, wrap, focalFracX, focalFracY, fx, fy);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      // Pinch-zoom is disabled in a two-page spread (it never reads well across
      // two cropped pages); let the touches pan/scroll normally instead.
      if (spreadActiveRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      beginPinch(e.touches);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || spreadActiveRef.current) return;
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

    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("wheel", onWheel, { passive: false });
    scroller.addEventListener("touchstart", onTouchStart, { passive: false, capture: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    scroller.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });
    scroller.addEventListener("touchcancel", onTouchCancel, { passive: true, capture: true });
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
  }, [ready, publishPosition]);

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
          const [preferredPage, ...fallbackPages] = order;
          const preferredGeom = await geometryFor(preferredPage!);
          if (preferredGeom) {
            const rects = locateOnPage(preferredGeom, h.quote);
            if (rects && rects.length > 0) return pdfAnchor(preferredPage!, rects);
          }
          const fallbackMatches = await Promise.all(
            fallbackPages.map(async (pageNum) => {
              const geom = await geometryFor(pageNum);
              if (!geom) return null;
              const rects = locateOnPage(geom, h.quote);
              return rects && rects.length > 0 ? pdfAnchor(pageNum, rects) : null;
            }),
          );
          for (const match of fallbackMatches) {
            if (match) return match;
          }
          return anchor.rects.length > 0 ? anchor : null;
        }).pipe(Effect.orElseSucceed(() => null)),
      search: (query) =>
        Effect.tryPromise(async () => {
          const doc = docRef.current;
          if (!doc || query.trim() === "") return [] as SearchMatch[];
          const matchesByPage = await Promise.all(
            Array.from({ length: doc.numPages }, async (_, index) => {
              const pageNum = index + 1;
              const geom = await geometryFor(pageNum);
              if (!geom) return [];
              return scanText(geom.text, query).map(({ start, excerpt }) => ({
                anchor: pdfAnchor(pageNum, rectsForRange(geom, start, start + query.length)),
                excerpt,
              }));
            }),
          );
          return matchesByPage.flat();
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
    fitToText,
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
    snapshot,
    reader,
    search,
  };
}
