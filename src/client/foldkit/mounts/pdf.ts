import { Effect, Queue, Schema, Stream } from "effect";
import { Mount } from "foldkit";
import { m } from "foldkit/message";
import type { TextLayerBuilder } from "pdfjs-dist/web/pdf_viewer.mjs";
import { clamp } from "../../../shared/format.ts";
import {
  HighlightAnchor,
  QuoteSelector,
  pdfAnchor,
  type PdfRect,
} from "../../../shared/types/notes.ts";
import { SourceReadingPosition } from "../../../shared/types/readingPositions.ts";
import { PdfPageLayout } from "../../../shared/types/userPrefs.ts";
import {
  expandToWordBoundaries,
  popupPoint,
  quoteForRange,
  scanText,
} from "../../logic/notes/highlights.ts";
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
  SPREAD_GUTTER_PX,
  cropBox,
  spreadFits,
  spreadPages,
  spreadStart,
} from "../../logic/reader/pdfSpread.ts";
import {
  getCachedPdfDocument,
  hasCachedPdfDocument,
  putCachedPdfDocument,
} from "../../logic/reader/renderCache.ts";
import { putRenderSnapshot } from "../../logic/reader/renderSnapshot.ts";

const MAX_RENDER_DPR = 2;
const SPREAD_CROP_PAD_PX = 16;
const PDF_RECT_Y_NUDGE_PX = 4;
const TEXT_TOP_MARGIN_PX = 24;
const MIN_ZOOM = 50;
const MAX_ZOOM = 400;

const Point = Schema.Struct({ x: Schema.Number, y: Schema.Number });

export const PdfDocumentReady = m("PdfDocumentReady", {
  sourceId: Schema.String,
  totalPages: Schema.Number,
  title: Schema.NullOr(Schema.String),
});
export const PdfSpreadRendered = m("PdfSpreadRendered", {
  sourceId: Schema.String,
  pages: Schema.Array(Schema.Number),
  total: Schema.Number,
  spread: Schema.Boolean,
  atStart: Schema.Boolean,
  atEnd: Schema.Boolean,
  percentage: Schema.Number,
});
export const PdfDocumentLoadFailed = m("PdfDocumentLoadFailed", {
  sourceId: Schema.String,
  message: Schema.String,
});
export const PdfSelectionChanged = m("PdfSelectionChanged", {
  sourceId: Schema.String,
  anchor: Schema.NullOr(HighlightAnchor),
  quote: Schema.NullOr(QuoteSelector),
  point: Schema.NullOr(Point),
});
export const PdfPositionChanged = m("PdfPositionChanged", {
  sourceId: Schema.String,
  position: SourceReadingPosition,
});

export type PdfMountMessage =
  | typeof PdfDocumentReady.Type
  | typeof PdfSpreadRendered.Type
  | typeof PdfDocumentLoadFailed.Type
  | typeof PdfSelectionChanged.Type
  | typeof PdfPositionChanged.Type;

/** A cancellable rasterization of one page. pdf.js render tasks must be
 *  cancelled rather than dropped: an abandoned task keeps rasterizing into a
 *  canvas the Mount has already released. */
export interface PdfRenderTask {
  readonly promise: Promise<void>;
  readonly cancel: () => void;
}

type PdfViewport = ReturnType<PDFPageProxy["getViewport"]>;

export interface PdfRasterizeRequest {
  readonly page: PDFPageProxy;
  readonly canvas: HTMLCanvasElement;
  readonly viewport: PdfViewport;
  readonly dpr: number;
}

/** The live seams the Mount needs from the outside world. Everything here is
 *  imperative and environment-bound, which is exactly what keeps the Model
 *  free of handles: the application supplies one environment at construction
 *  and the Mount owns whatever it produces for the element's lifetime. */
export interface PdfMountEnvironment {
  readonly loadSource: (sourceId: string, groupRef: string) => Promise<ArrayBuffer>;
  readonly loadDocument: (bytes: ArrayBuffer) => Promise<PDFDocumentProxy>;
  readonly rasterize: (request: PdfRasterizeRequest) => PdfRenderTask;
  readonly loadTextLayerBuilder: (() => Promise<typeof TextLayerBuilder>) | null;
  readonly devicePixelRatio: () => number;
  /** Keeping a parsed document alive across mounts skips the reparse when a
   *  reader is reopened. Mobile callers disable it: a backgrounded pdf.js
   *  worker can be reclaimed by the OS, and the next RPC to it never settles. */
  readonly cacheDocumentsAcrossMounts: boolean;
  /** Snapshotting encodes the rendered page on every render to give the next
   *  open an instant placeholder. Callers without a canvas backend, and mobile
   *  callers paying that cost on every page turn, disable it. */
  readonly captureSnapshots: boolean;
}

export const canvasRasterizer = ({
  page,
  canvas,
  viewport,
  dpr,
}: PdfRasterizeRequest): PdfRenderTask => {
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.cssText = `width:${viewport.width}px;height:${viewport.height}px;`;
  const context = canvas.getContext("2d");
  if (!context) return { promise: Promise.resolve(), cancel: () => {} };
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const task = page.render({ canvas, canvasContext: context, viewport });
  return { promise: task.promise.then(() => {}), cancel: () => task.cancel() };
};

export const browserPdfMountEnvironment = (
  loadSource: (sourceId: string, groupRef: string) => Promise<ArrayBuffer>,
  overrides: Partial<PdfMountEnvironment> = {},
): PdfMountEnvironment => ({
  loadSource,
  loadDocument: loadPdf,
  rasterize: canvasRasterizer,
  loadTextLayerBuilder: loadTextLayerBuilderCtor,
  devicePixelRatio: () => globalThis.devicePixelRatio || 1,
  cacheDocumentsAcrossMounts: true,
  captureSnapshots: true,
  ...overrides,
});

interface Pane {
  el: HTMLDivElement;
  inner: HTMLDivElement;
  canvas: HTMLCanvasElement;
  highlight: HTMLDivElement;
  underline: HTMLDivElement;
  selection: HTMLDivElement;
  builder: TextLayerBuilder | null;
  textLayer: HTMLDivElement | null;
  page: number | null;
  pageHeightPx: number;
  cropTopPx: number;
}

interface Session {
  readonly environment: PdfMountEnvironment;
  readonly sourceId: string;
  readonly groupRef: string;
  readonly layout: PdfPageLayout;
  readonly zoom: number;
  readonly scroller: HTMLDivElement;
  readonly wrap: HTMLDivElement;
  readonly panes: Pane[];
  readonly geometry: Map<number, PageGeometry>;
  /** The highlights the reader wants painted, by id. A spread change or a page
   *  turn rebuilds the panes, so the session repaints from this rather than
   *  from what the previous panes held. */
  readonly highlights: Map<string, HighlightAnchor>;
  readonly renderTasks: Set<PdfRenderTask>;
  readonly teardown: (() => void)[];
  readonly emit: (message: PdfMountMessage) => void;
  document: PDFDocumentProxy | null;
  documentCacheKey: string | null;
  renderSeq: number;
  page: number;
  spread: boolean;
  searchAnchor: HighlightAnchor | null;
  released: boolean;
}

function createPane(): Pane {
  const el = document.createElement("div");
  el.className = "pdf-pane";
  const inner = document.createElement("div");
  inner.className = "pdf-pane-inner";
  inner.style.position = "absolute";
  el.appendChild(inner);
  const canvas = document.createElement("canvas");
  const layer = (className: string) => {
    const node = document.createElement("div");
    node.className = className;
    node.style.cssText = "position:absolute;inset:0;pointer-events:none;";
    return node;
  };
  const highlight = layer("pdf-highlights");
  const underline = layer("pdf-underlines");
  const selection = layer("pdf-selection");
  for (const child of [canvas, highlight, underline, selection]) inner.appendChild(child);
  return {
    el,
    inner,
    canvas,
    highlight,
    underline,
    selection,
    builder: null,
    textLayer: null,
    page: null,
    pageHeightPx: 0,
    cropTopPx: 0,
  };
}

function textBounds(
  geometry: PageGeometry | null,
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  if (!geometry || geometry.runs.length === 0) return null;
  return {
    minX: Math.min(...geometry.runs.map((run) => run.x)),
    maxX: Math.max(...geometry.runs.map((run) => run.x + run.width)),
    minY: Math.min(...geometry.runs.map((run) => run.y)),
    maxY: Math.max(...geometry.runs.map((run) => run.y + run.height)),
  };
}

/** Client rects of the selected *text* only, mapped into fractions of the
 *  full-page box. Walking text nodes ignores pdf.js's stretched
 *  `.endOfContent` selection sink, which would otherwise inflate the anchor
 *  to the whole page. */
export function pdfSelectionRects(range: Range, textLayer: Node, box: DOMRect): PdfRect[] {
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  const rects: DOMRect[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    const sub = document.createRange();
    sub.selectNodeContents(node);
    if (node === range.startContainer) sub.setStart(node, range.startOffset);
    if (node === range.endContainer) sub.setEnd(node, range.endOffset);
    rects.push(...sub.getClientRects());
  }
  if (box.width <= 0 || box.height <= 0) return [];
  return rects.map((rect) => ({
    x: (rect.left - box.left) / box.width,
    y: (rect.top - box.top) / box.height,
    width: rect.width / box.width,
    height: rect.height / box.height,
  }));
}

export function boundingClientRect(rects: readonly DOMRect[]): DOMRect {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return new DOMRect(left, top, right - left, bottom - top);
}

/** Renderer-independent in-page search: the same text scan the React reader
 *  uses, resolved against captured page geometry into page anchors. Commands
 *  call this with the geometry the Mount has published; it touches no DOM. */
export interface PdfSearchMatch {
  anchor: HighlightAnchor;
  excerpt: string;
}

const EXCERPT_CONTEXT = 40;

export function pdfSearchMatches(
  geometry: ReadonlyMap<number, PageGeometry>,
  query: string,
): PdfSearchMatch[] {
  return [...geometry.entries()]
    .toSorted(([a], [b]) => a - b)
    .flatMap(([page, pageGeom]) =>
      scanText(pageGeom.text, query).map((match) => {
        const end = match.start + query.length;
        return {
          anchor: pdfAnchor(page, rectsForRange(pageGeom, match.start, end)),
          excerpt: pageGeom.text
            .slice(Math.max(0, match.start - EXCERPT_CONTEXT), end + EXCERPT_CONTEXT)
            .trim(),
        };
      }),
    );
}

export function pdfSearchAnchors(
  geometry: ReadonlyMap<number, PageGeometry>,
  query: string,
): HighlightAnchor[] {
  return pdfSearchMatches(geometry, query).map((match) => match.anchor);
}

function paintRects(layer: HTMLDivElement, rects: readonly PdfRect[], className: string): void {
  const width = layer.clientWidth;
  const height = layer.clientHeight;
  for (const rect of rects) {
    const node = document.createElement("div");
    node.className = className;
    node.style.cssText = `position:absolute;left:${rect.x * width}px;top:${
      rect.y * height + PDF_RECT_Y_NUDGE_PX
    }px;width:${rect.width * width}px;height:${rect.height * height}px;`;
    layer.appendChild(node);
  }
}

/** Paint every wanted annotation into the pane showing its page. Panes are
 *  rebuilt on each render, so this is the only way annotations survive a page
 *  turn or a spread change. */
function paintAnnotations(session: Session): void {
  for (const pane of session.panes) {
    pane.highlight.replaceChildren();
    pane.underline.replaceChildren();
  }
  const paint = (anchor: HighlightAnchor, layerOf: (pane: Pane) => HTMLDivElement, cls: string) => {
    if (anchor.kind !== "pdf-text") return;
    const pane = session.panes.find((candidate) => candidate.page === anchor.page);
    if (pane) paintRects(layerOf(pane), anchor.rects, cls);
  };
  for (const anchor of session.highlights.values()) {
    paint(anchor, (pane) => pane.highlight, "bc-highlight");
  }
  if (session.searchAnchor) paint(session.searchAnchor, (pane) => pane.underline, "bc-search");
}

/** The zoom at which the current spread's *text* fills the viewport. Returns
 *  null when nothing is open or the pages carry no text geometry to fit to (a
 *  scan), in which case the reader leaves the zoom alone. */
async function computeFitZoom(session: Session): Promise<number | null> {
  const doc = session.document;
  if (!doc || session.released) return null;
  const left = session.page;
  const pages = spreadPages(left, session.spread, doc.numPages);
  const measured = await Promise.all(
    pages.map(async (pageNum) => {
      const page = await doc.getPage(pageNum);
      return {
        base: page.getViewport({ scale: 1 }),
        bounds: textBounds(await geometryFor(session, pageNum)),
      };
    }),
  );
  const first = measured[0];
  if (!first || session.released || session.page !== left) return null;

  // With a spread each page is cropped to its own text, so the fit is against
  // the combined text width; a single page is uncropped, so it fits its full
  // width. Height fits the union of both pages' vertical extents, which is what
  // the render actually crops to.
  let combinedWidth = 0;
  let unionMinY = Infinity;
  let unionMaxY = -Infinity;
  let maxBaseHeight = 0;
  let anyText = false;
  for (const { base, bounds } of measured) {
    maxBaseHeight = Math.max(maxBaseHeight, base.height);
    if (bounds === null) {
      combinedWidth += base.width;
      continue;
    }
    anyText = true;
    combinedWidth += session.spread ? (bounds.maxX - bounds.minX) * base.width : base.width;
    unionMinY = Math.min(unionMinY, bounds.minY);
    unionMaxY = Math.max(unionMaxY, bounds.maxY);
  }
  if (!anyText) return null;

  const gutter = pages.length > 1 ? SPREAD_GUTTER_PX : 0;
  const pad = session.spread ? SPREAD_CROP_PAD_PX : 0;
  const fit =
    pages.length > 1
      ? (session.scroller.clientWidth - gutter) / (2 * first.base.width)
      : session.scroller.clientWidth / first.base.width;
  const widthBudget =
    session.scroller.clientWidth - gutter - 2 * TEXT_TOP_MARGIN_PX - pages.length * 2 * pad;
  const widthScale = Math.max(1, widthBudget) / combinedWidth;
  const heightScale =
    Math.max(1, session.scroller.clientHeight - 2 * TEXT_TOP_MARGIN_PX - 2 * pad) /
    ((unionMaxY - unionMinY) * maxBaseHeight);
  // Floor rather than round: a zoom above the computed scale leaves a sliver of
  // scroll range, so a fit would immediately be followed by a scroll.
  return Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, Math.floor((Math.min(widthScale, heightScale) / fit) * 100)),
  );
}

function documentCacheKey(environment: PdfMountEnvironment, sourceId: string, bytes: number) {
  return environment.cacheDocumentsAcrossMounts ? `${sourceId}:${bytes}` : null;
}

function openSession(
  element: Element,
  environment: PdfMountEnvironment,
  args: {
    sourceId: string;
    groupRef: string;
    initialPage: number;
    zoom: number;
    layout: PdfPageLayout;
  },
  emit: (message: PdfMountMessage) => void,
): Session {
  const scroller = document.createElement("div");
  scroller.className = "pdf-scroller";
  const wrap = document.createElement("div");
  wrap.className = "pdf-page";
  wrap.style.position = "relative";
  wrap.style.margin = "0 auto";
  scroller.appendChild(wrap);
  element.appendChild(scroller);

  const session: Session = {
    environment,
    sourceId: args.sourceId,
    groupRef: args.groupRef,
    layout: args.layout,
    zoom: args.zoom,
    scroller,
    wrap,
    panes: [],
    geometry: new Map(),
    highlights: new Map(),
    renderTasks: new Set(),
    teardown: [],
    emit,
    document: null,
    documentCacheKey: null,
    renderSeq: 0,
    page: Math.max(1, Math.round(args.initialPage)),
    spread: false,
    searchAnchor: null,
    released: false,
  };

  const onScroll = () => publishPosition(session);
  scroller.addEventListener("scroll", onScroll, { passive: true });
  session.teardown.push(() => scroller.removeEventListener("scroll", onScroll));

  const onSelectionChange = () => publishSelection(session);
  document.addEventListener("selectionchange", onSelectionChange);
  session.teardown.push(() => document.removeEventListener("selectionchange", onSelectionChange));

  // ResizeObserver is absent outside browsers (jsdom, workerd); a Mount that
  // simply never re-fits is preferable to one that cannot acquire at all.
  if (typeof ResizeObserver === "function") {
    let lastWidth = scroller.clientWidth;
    const observer = new ResizeObserver(() => {
      if (scroller.clientWidth === lastWidth) return;
      lastWidth = scroller.clientWidth;
      void renderSpread(session, environment);
    });
    observer.observe(scroller);
    session.teardown.push(() => observer.disconnect());
  }

  return session;
}

function closeSession(session: Session): void {
  session.released = true;
  session.renderSeq += 1;
  for (const task of session.renderTasks) task.cancel();
  session.renderTasks.clear();
  for (const off of session.teardown) off();
  session.teardown.length = 0;
  for (const pane of session.panes) {
    pane.builder?.cancel();
    pane.builder?.div.remove();
  }
  session.panes.length = 0;
  const doc = session.document;
  session.document = null;
  const key = session.documentCacheKey;
  if (doc && !(key !== null && hasCachedPdfDocument(key, doc))) void destroyPdf(doc);
  session.scroller.remove();
}

function ensurePanes(session: Session, count: number): Pane[] {
  const { panes, wrap } = session;
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
}

async function geometryFor(session: Session, page: number): Promise<PageGeometry | null> {
  const doc = session.document;
  if (!doc || page < 1 || page > doc.numPages) return null;
  const cached = session.geometry.get(page);
  if (cached) return cached;
  const geometry = await pageGeometry(await doc.getPage(page));
  session.geometry.set(page, geometry);
  return geometry;
}

function publishPosition(session: Session): void {
  const doc = session.document;
  if (!doc || session.released) return;
  const { scroller } = session;
  const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const scrollRatio = maxScroll > 0 ? clamp(scroller.scrollTop / maxScroll, 0, 1) : 0;
  session.emit(
    PdfPositionChanged({
      sourceId: session.sourceId,
      position: {
        kind: "pdf",
        page: session.page,
        scrollRatio,
        zoom: session.zoom,
        percentage: doc.numPages > 0 ? (session.page - 1 + scrollRatio) / doc.numPages : 0,
      },
    }),
  );
}

function publishSelection(session: Session): void {
  if (session.released) return;
  const selection = globalThis.getSelection?.();
  const clear = () => {
    for (const pane of session.panes) pane.selection.replaceChildren();
    session.emit(
      PdfSelectionChanged({ sourceId: session.sourceId, anchor: null, quote: null, point: null }),
    );
  };
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return clear();
  const raw = selection.getRangeAt(0);
  const pane = session.panes.find((p) => p.textLayer !== null && raw.intersectsNode(p.textLayer));
  if (!pane?.textLayer || pane.page === null) return;

  const range = expandToWordBoundaries(raw);
  const rects = pdfSelectionRects(range, pane.textLayer, pane.inner.getBoundingClientRect());
  if (rects.length === 0) return;
  pane.selection.replaceChildren();
  paintRects(pane.selection, rects, "bc-selection");
  const anchor = pdfAnchor(pane.page, rects);
  const box = boundingClientRect(
    rects.map((rect) => {
      const inner = pane.inner.getBoundingClientRect();
      return new DOMRect(
        inner.left + rect.x * inner.width,
        inner.top + rect.y * inner.height,
        rect.width * inner.width,
        rect.height * inner.height,
      );
    }),
  );
  session.emit(
    PdfSelectionChanged({
      sourceId: session.sourceId,
      anchor,
      quote: quoteForRange(range, "pdf-text"),
      point: popupPoint(box),
    }),
  );
}

function captureSnapshot(session: Session, total: number): void {
  if (!session.environment.captureSnapshots) return;
  const pane = session.panes[0];
  // A zero-sized backing store means nothing was rasterized (no canvas backend).
  if (!pane || pane.page === null || pane.canvas.width === 0 || pane.canvas.height === 0) return;
  try {
    const dataUrl = pane.canvas.toDataURL("image/webp", 0.82);
    if (!dataUrl.startsWith("data:image/")) return;
    putRenderSnapshot({
      sourceId: session.sourceId,
      kind: "pdf",
      locationKey: `pdf:${session.page}:${total}:${pane.canvas.width}x${pane.canvas.height}`,
      width: pane.canvas.width,
      height: pane.canvas.height,
      dataUrl,
      capturedAt: Date.now(),
    });
  } catch {
    // A snapshot is an opening-placeholder optimization; never fail a render for it.
  }
}

function renderTextLayer(
  session: Session,
  environment: PdfMountEnvironment,
  pane: Pane,
  page: PDFPageProxy,
  viewport: PdfViewport,
  seq: number,
): void {
  const load = environment.loadTextLayerBuilder;
  if (!load) return;
  // The text layer ships in a separately imported chunk; when it is unavailable
  // the page must stay readable, so only selection and search are lost.
  void (async () => {
    try {
      const TextLayerBuilderCtor = await load();
      if (seq !== session.renderSeq) return;
      const builder = new TextLayerBuilderCtor({ pdfPage: page });
      // SAFETY: the builder only consumes the viewport member supplied by pdf.js here.
      await builder.render({ viewport } as Parameters<typeof builder.render>[0]);
      if (seq !== session.renderSeq || !session.panes.includes(pane)) {
        builder.cancel();
        builder.div.remove();
        return;
      }
      pane.builder?.cancel();
      pane.builder?.div.remove();
      pane.builder = builder;
      pane.textLayer = builder.div;
      pane.inner.appendChild(builder.div);
    } catch {
      pane.textLayer = null;
    }
  })();
}

async function renderSpread(session: Session, environment: PdfMountEnvironment): Promise<void> {
  const doc = session.document;
  if (!doc || session.released) return;
  const seq = ++session.renderSeq;
  const stale = () => seq !== session.renderSeq || session.released;

  const spread = spreadFits(session.layout, doc.numPages, session.scroller.clientWidth);
  session.spread = spread;
  const left = spreadStart(session.page, spread);
  session.page = left;
  const pages = spreadPages(left, spread, doc.numPages);
  const panes = ensurePanes(session, pages.length);
  const gutter = pages.length > 1 ? SPREAD_GUTTER_PX : 0;
  const dpr = Math.min(environment.devicePixelRatio(), MAX_RENDER_DPR);

  const firstPage = await doc.getPage(pages[0]!);
  if (stale()) return;
  const base = firstPage.getViewport({ scale: 1 });
  const available = session.wrap.parentElement?.clientWidth || base.width;
  const fit = pages.length > 1 ? (available - gutter) / (2 * base.width) : available / base.width;
  const scale = fit * (session.zoom / 100);
  session.wrap.style.setProperty("--pdf-spread-gutter", `${gutter}px`);
  session.wrap.style.setProperty("--total-scale-factor", String(scale));
  session.wrap.style.setProperty("--scale-factor", String(scale));

  // In a spread each page is cropped to its text: horizontally to its own
  // bounds, vertically to the union so the two pages stay aligned.
  const bounds = new Map<number, ReturnType<typeof textBounds>>();
  let unionMinY = Infinity;
  let unionMaxY = -Infinity;
  if (spread) {
    for (const pageNum of pages) {
      const pageBounds = textBounds(await geometryFor(session, pageNum));
      if (stale()) return;
      bounds.set(pageNum, pageBounds);
      if (pageBounds) {
        unionMinY = Math.min(unionMinY, pageBounds.minY);
        unionMaxY = Math.max(unionMaxY, pageBounds.maxY);
      }
    }
  }
  const vertical = spread && unionMinY !== Infinity ? { minY: unionMinY, maxY: unionMaxY } : null;

  let totalWidth = 0;
  let maxHeight = 0;
  for (const [index, pageNum] of pages.entries()) {
    const pane = panes[index]!;
    const page = index === 0 ? firstPage : await doc.getPage(pageNum);
    if (stale()) return;
    const viewport = page.getViewport({ scale });
    pane.page = pageNum;

    const task = environment.rasterize({ page, canvas: pane.canvas, viewport, dpr });
    session.renderTasks.add(task);
    try {
      await task.promise;
    } catch {
      // A cancelled task is the release path doing its job, not a failure.
      return;
    } finally {
      session.renderTasks.delete(task);
    }
    if (stale()) return;

    const crop = cropBox(
      spread ? (bounds.get(pageNum) ?? null) : null,
      vertical,
      viewport.width,
      viewport.height,
      SPREAD_CROP_PAD_PX,
    );
    pane.inner.style.width = `${viewport.width}px`;
    pane.inner.style.height = `${viewport.height}px`;
    pane.inner.style.left = `${-crop.left}px`;
    pane.inner.style.top = `${-crop.top}px`;
    pane.el.style.width = `${crop.width}px`;
    pane.el.style.height = `${crop.height}px`;
    pane.pageHeightPx = viewport.height;
    pane.cropTopPx = crop.top;
    totalWidth += crop.width;
    maxHeight = Math.max(maxHeight, crop.height);

    renderTextLayer(session, environment, pane, page, viewport, seq);
  }

  session.wrap.style.width = `${totalWidth + gutter}px`;
  session.wrap.style.height = `${maxHeight}px`;

  const lastPage = pages.at(-1) ?? left;
  session.emit(
    PdfSpreadRendered({
      sourceId: session.sourceId,
      pages,
      total: doc.numPages,
      spread,
      atStart: left <= 1,
      atEnd: lastPage >= doc.numPages,
      percentage: doc.numPages > 0 ? left / doc.numPages : 0,
    }),
  );
  paintAnnotations(session);
  captureSnapshot(session, doc.numPages);
  publishPosition(session);
}

async function startSession(session: Session, environment: PdfMountEnvironment): Promise<void> {
  try {
    const bytes = await environment.loadSource(session.sourceId, session.groupRef);
    const key = documentCacheKey(environment, session.sourceId, bytes.byteLength);
    session.documentCacheKey = key;
    const cached = key === null ? null : getCachedPdfDocument(key);
    const doc = cached ?? (await environment.loadDocument(bytes));
    // The release may have run while the document was still parsing: an Effect
    // interruption does not cancel the underlying promise, so the handle only
    // becomes reachable here and must be disposed of on the spot.
    if (session.released) {
      if (!cached) void destroyPdf(doc);
      return;
    }
    if (key !== null && !cached) putCachedPdfDocument(key, doc, bytes.byteLength);
    session.document = doc;
    session.page = clamp(session.page, 1, Math.max(1, doc.numPages));

    const metadata = await doc.getMetadata().catch(() => null);
    // SAFETY: pdf.js metadata info is an optional string-keyed dictionary.
    const info = metadata?.info as { Title?: string } | undefined;
    if (session.released) return;
    session.emit(
      PdfDocumentReady({
        sourceId: session.sourceId,
        totalPages: doc.numPages,
        title: info?.Title?.trim() || null,
      }),
    );
    await renderSpread(session, environment);
  } catch (error) {
    if (session.released) return;
    session.emit(
      PdfDocumentLoadFailed({
        sourceId: session.sourceId,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/**
 * The PDF.js Mount. One element, one open document: the Mount owns the
 * document handle, page render tasks, canvases, text-layer builders, the
 * resize observer, and the selection listener, and publishes only domain
 * events back into the Message loop.
 *
 * Args are captured at mount, so a source, layout, or zoom change is expressed
 * as a new element key in the view. That destroys this element — cancelling
 * in-flight render tasks and destroying the document — before the replacement
 * acquires, which is what makes source switching deterministic.
 */
export const makePdfDocumentMount = (environment: PdfMountEnvironment) =>
  makePdfMount(environment).Mount;

/**
 * The PDF.js adapter: the Mount plus the imperative operations the reader's
 * Commands need against whichever document is currently displayed. The Mount
 * owns the document handle, page render tasks, canvases, text-layer builders,
 * the resize observer, and the selection listener, and publishes only domain
 * events back into the Message loop.
 *
 * Args are captured at mount, so a source or layout change is expressed as a
 * new element key in the view. That destroys this element — cancelling
 * in-flight render tasks and destroying the document — before the replacement
 * acquires, which is what makes source switching deterministic. Everything the
 * reader changes *without* rebuilding the document (page, highlights, search
 * match) goes through the operations below instead.
 */
export const makePdfMount = (environment: PdfMountEnvironment) => {
  let live: Session | null = null;

  const onLiveSession = (use: (session: Session) => Promise<void> | void) =>
    Effect.suspend(() => {
      const session = live;
      if (session === null || session.released) return Effect.void;
      return Effect.promise(async () => {
        await use(session);
      });
    });

  const PdfDocument = Mount.defineStream(
    "PdfDocument",
    {
      sourceId: Schema.String,
      groupRef: Schema.String,
      initialPage: Schema.Number,
      zoom: Schema.Number,
      layout: PdfPageLayout,
    },
    PdfDocumentReady,
    PdfSpreadRendered,
    PdfDocumentLoadFailed,
    PdfSelectionChanged,
    PdfPositionChanged,
  )(
    (args) => (element) =>
      Stream.callback<PdfMountMessage>((queue) =>
        Effect.gen(function* () {
          const session = yield* Effect.acquireRelease(
            Effect.sync(() => {
              const opened = openSession(element, environment, args, (message) => {
                Queue.offerUnsafe(queue, message);
              });
              live = opened;
              return opened;
            }),
            (opened) =>
              Effect.sync(() => {
                // A previous scope can release after the next one acquires, so
                // only the session that is still current clears the handle.
                if (live === opened) live = null;
                closeSession(opened);
              }),
          );
          yield* Effect.promise(() => startSession(session, environment));
          return yield* Effect.never;
        }),
      ),
  );

  const showPage = (session: Session, page: number) => {
    const total = session.document?.numPages ?? 1;
    const next = clamp(Math.round(page), 1, Math.max(1, total));
    if (next === session.page) return Promise.resolve();
    session.page = next;
    // A page entered from a turn rests at its top rather than inheriting the
    // previous page's scroll offset.
    session.scroller.scrollTop = 0;
    return renderSpread(session, environment);
  };

  return {
    Mount: PdfDocument,
    turnPage: (direction: "next" | "previous") =>
      onLiveSession((session) => {
        const step = (session.spread ? 2 : 1) * (direction === "next" ? 1 : -1);
        return showPage(session, session.page + step);
      }),
    goTo: (anchor: HighlightAnchor) =>
      onLiveSession((session) => {
        if (anchor.kind !== "pdf-text") return;
        return showPage(session, anchor.page);
      }),
    syncHighlights: (highlights: readonly { id: string; anchor: HighlightAnchor }[]) =>
      onLiveSession((session) => {
        session.highlights.clear();
        for (const { id, anchor } of highlights) session.highlights.set(id, anchor);
        paintAnnotations(session);
      }),
    setSearchHighlight: (anchor: HighlightAnchor | null) =>
      onLiveSession((session) => {
        session.searchAnchor = anchor;
        paintAnnotations(session);
      }),
    /** The renderer-independent text scan over the geometry the open document
     *  has captured, so search does not reach back into the DOM. */
    search: (query: string) =>
      Effect.suspend(() => {
        const session = live;
        if (session === null || session.document === null) {
          return Effect.succeed<readonly PdfSearchMatch[]>([]);
        }
        const doc = session.document;
        return Effect.promise(async () => {
          for (let page = 1; page <= doc.numPages; page++) {
            if (session.released) break;
            await geometryFor(session, page);
          }
          return pdfSearchMatches(session.geometry, query);
        });
      }),
    /** The zoom that would make the current spread's text fill the viewport.
     *  The reader applies it through the Model, because zoom is part of this
     *  Mount's element key. */
    fitZoom: Effect.suspend(() => {
      const session = live;
      if (session === null || session.released) return Effect.succeed(null);
      return Effect.promise(() => computeFitZoom(session)).pipe(Effect.orElseSucceed(() => null));
    }),
    dismissSelection: Effect.sync(() => {
      globalThis.getSelection?.()?.removeAllRanges();
    }),
  };
};

export type PdfMountAdapter = ReturnType<typeof makePdfMount>;
