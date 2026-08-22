import { Effect, Queue, Schema, Stream } from "effect";
import { Mount } from "foldkit";
import { m } from "foldkit/message";
import type { TextLayerBuilder } from "pdfjs-dist/web/pdf_viewer.mjs";
import { hexToRgb } from "../../../shared/color.ts";
import { clamp } from "../../../shared/format.ts";
import {
  HighlightAnchor,
  QuoteSelector,
  pdfAnchor,
  type PdfRect,
} from "../../../shared/types/notes.ts";
import { SourceReadingPosition } from "../../../shared/types/readingPositions.ts";
import { PdfPageLayout } from "../../../shared/types/userPrefs.ts";
import { SmartArrows } from "../../../shared/types/userPrefs.ts";
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
  PdfRasterCache,
  putCachedPdfDocument,
} from "../../logic/reader/renderCache.ts";
import { putRenderSnapshot } from "../../logic/reader/renderSnapshot.ts";

const MAX_RENDER_DPR = 2;
const SPREAD_CROP_PAD_PX = 16;
const PDF_RECT_Y_NUDGE_PX = 4;
const TEXT_TOP_MARGIN_PX = 24;
const SCROLL_EDGE_EPSILON_PX = 20;
const MIN_ZOOM = 50;
const MAX_ZOOM = 400;

const Point = Schema.Struct({ x: Schema.Number, y: Schema.Number });

export const PdfDocumentReady = m("PdfDocumentReady", {
  sourceId: Schema.String,
  totalPages: Schema.Number,
  title: Schema.NullOr(Schema.String),
  zoom: Schema.Number,
});
export const PdfSpreadRendered = m("PdfSpreadRendered", {
  sourceId: Schema.String,
  pages: Schema.Array(Schema.Number),
  total: Schema.Number,
  spread: Schema.Boolean,
  atStart: Schema.Boolean,
  atEnd: Schema.Boolean,
  percentage: Schema.Number,
  zoom: Schema.Number,
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

/** A PDF page is rasterized once into a canvas — there's no live stylesheet
 *  left to theme afterward, only pixels. `recolorPdfCanvas` is the closest a
 *  baked page gets to following the theme. */
export interface PdfColors {
  readonly background: string;
  readonly text: string;
}

export interface PdfRasterizeRequest {
  readonly page: PDFPageProxy;
  readonly canvas: HTMLCanvasElement;
  readonly viewport: PdfViewport;
  readonly dpr: number;
  readonly colors: PdfColors;
  /** A spread reveals both themed panes together after every page is ready. */
  readonly deferReveal?: boolean;
}

const DEFAULT_PDF_COLORS: PdfColors = { background: "#ffffff", text: "#000000" };

const isDefaultPdfColors = (colors: PdfColors): boolean =>
  colors.background.toLowerCase() === DEFAULT_PDF_COLORS.background &&
  colors.text.toLowerCase() === DEFAULT_PDF_COLORS.text;

const GRAYSCALE_SATURATION_THRESHOLD = 24;

/**
 * A PDF page is baked pixels, not a stylesheet, so theming it is a tradeoff:
 * this remaps only near-grayscale pixels (the ink and the paper) onto the
 * theme's text/background colors, by luminance, and leaves anything more
 * saturated alone — photos, colored diagrams, colored ink — the same
 * restraint a "smart" e-reader dark mode uses so illustrations don't get
 * inverted into unreadable negatives.
 */
export function recolorPdfCanvas(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  colors: PdfColors,
): void {
  if (width <= 0 || height <= 0 || isDefaultPdfColors(colors)) return;
  const [bgR, bgG, bgB] = hexToRgb(colors.background);
  const [textR, textG, textB] = hexToRgb(colors.text);
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (Math.max(r, g, b) - Math.min(r, g, b) > GRAYSCALE_SATURATION_THRESHOLD) continue;
    const lum = (r + g + b) / (3 * 255);
    data[i] = Math.round(textR + (bgR - textR) * lum);
    data[i + 1] = Math.round(textG + (bgG - textG) * lum);
    data[i + 2] = Math.round(textB + (bgB - textB) * lum);
  }
  context.putImageData(imageData, 0, 0);
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
  /** Browser readers warm adjacent spreads; deterministic/low-memory hosts can opt out. */
  readonly prefetchAdjacentPages: boolean;
}

export const canvasRasterizer = ({
  page,
  canvas,
  viewport,
  dpr,
  colors,
  deferReveal = false,
}: PdfRasterizeRequest): PdfRenderTask => {
  const themed = !isDefaultPdfColors(colors);
  // PDF.js paints progressively in the document's original colors. Keep that
  // intermediate frame out of view until its pixels have been remapped, or a
  // dark reader flashes a white page on every turn.
  if (themed) canvas.style.visibility = "hidden";
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.cssText = `width:${viewport.width}px;height:${viewport.height}px;`;
  if (themed) canvas.style.visibility = "hidden";
  const context = canvas.getContext("2d");
  if (!context) {
    if (!deferReveal) canvas.style.visibility = "visible";
    return { promise: Promise.resolve(), cancel: () => {} };
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const task = page.render({ canvas, canvasContext: context, viewport });
  const promise = task.promise.then(() => {
    recolorPdfCanvas(context, canvas.width, canvas.height, colors);
    if (!deferReveal) canvas.style.visibility = "visible";
  });
  return { promise, cancel: () => task.cancel() };
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
  prefetchAdjacentPages: true,
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
  zoom: number;
  smartArrows: SmartArrows;
  colors: PdfColors;
  readonly scroller: HTMLDivElement;
  readonly wrap: HTMLDivElement;
  readonly panes: Pane[];
  readonly geometry: Map<number, PageGeometry>;
  /** The highlights the reader wants painted, by id. A spread change or a page
   *  turn rebuilds the panes, so the session repaints from this rather than
   *  from what the previous panes held. */
  readonly highlights: Map<string, HighlightAnchor>;
  readonly renderTasks: Set<PdfRenderTask>;
  readonly rasterCache: PdfRasterCache;
  readonly prefetching: Set<string>;
  readonly prefetchTasks: Map<string, PdfRenderTask>;
  readonly prefetchPromises: Map<string, Promise<void>>;
  readonly teardown: (() => void)[];
  readonly emit: (message: PdfMountMessage) => void;
  document: PDFDocumentProxy | null;
  documentCacheKey: string | null;
  renderSeq: number;
  page: number;
  spread: boolean;
  searchAnchor: HighlightAnchor | null;
  fitToPage: boolean;
  released: boolean;
  snapshotTimer: number | null;
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
async function computeFitZoomAt(
  session: Session,
  left: number,
  spread: boolean,
): Promise<number | null> {
  const doc = session.document;
  if (!doc || session.released) return null;
  const pages = spreadPages(left, spread, doc.numPages);
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
  if (!first || session.released) return null;

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
    combinedWidth += spread ? (bounds.maxX - bounds.minX) * base.width : base.width;
    unionMinY = Math.min(unionMinY, bounds.minY);
    unionMaxY = Math.max(unionMaxY, bounds.maxY);
  }
  if (!anyText) return null;

  const gutter = pages.length > 1 ? SPREAD_GUTTER_PX : 0;
  const pad = spread ? SPREAD_CROP_PAD_PX : 0;
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

const computeFitZoom = (session: Session): Promise<number | null> =>
  computeFitZoomAt(session, session.page, session.spread);

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
    colors: PdfColors;
    smartArrows: SmartArrows;
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
    colors: args.colors,
    smartArrows: args.smartArrows,
    scroller,
    wrap,
    panes: [],
    geometry: new Map(),
    highlights: new Map(),
    renderTasks: new Set(),
    rasterCache: new PdfRasterCache(),
    prefetching: new Set(),
    prefetchTasks: new Map(),
    prefetchPromises: new Map(),
    teardown: [],
    emit,
    document: null,
    documentCacheKey: null,
    renderSeq: 0,
    page: Math.max(1, Math.round(args.initialPage)),
    spread: false,
    searchAnchor: null,
    fitToPage: true,
    released: false,
    snapshotTimer: null,
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
      cancelPrefetch(session);
      session.rasterCache.clear();
      session.scroller.dataset.prefetchedPages = "";
      const oldMax = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const ratio = oldMax > 0 ? scroller.scrollTop / oldMax : 0;
      const spreadFlipped =
        spreadFits(session.layout, session.document?.numPages ?? 1, scroller.clientWidth) !==
        session.spread;
      void (session.fitToPage || spreadFlipped
        ? fitSession(session, environment)
        : renderSpread(session, environment).then(() => {
            const newMax = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
            scroller.scrollTop = ratio * newMax;
          }));
    });
    observer.observe(scroller);
    session.teardown.push(() => observer.disconnect());
  }

  return session;
}

function closeSession(session: Session): void {
  session.released = true;
  session.renderSeq += 1;
  cancelPrefetch(session);
  for (const task of session.renderTasks) task.cancel();
  session.renderTasks.clear();
  session.rasterCache.clear();
  if (session.snapshotTimer !== null) clearTimeout(session.snapshotTimer);
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

function cancelPrefetch(session: Session): void {
  for (const task of session.prefetchTasks.values()) {
    task.cancel();
    session.renderTasks.delete(task);
  }
  session.prefetchTasks.clear();
  session.prefetchPromises.clear();
  session.prefetching.clear();
}

function cancelPrefetchExcept(session: Session, retainedKey: string): void {
  for (const [key, task] of session.prefetchTasks) {
    if (key === retainedKey) continue;
    task.cancel();
    session.renderTasks.delete(task);
    session.prefetchTasks.delete(key);
    session.prefetchPromises.delete(key);
    session.prefetching.delete(key);
  }
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

function scrollBounds(session: Session) {
  const { scroller } = session;
  const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  let minTop = Infinity;
  let maxBottom = -Infinity;
  for (const pane of session.panes) {
    if (pane.page === null) continue;
    const geometry = session.geometry.get(pane.page);
    if (!geometry || geometry.runs.length === 0) continue;
    const offset = pane.el.offsetTop - pane.cropTopPx;
    minTop = Math.min(
      minTop,
      offset + Math.min(...geometry.runs.map((run) => run.y)) * pane.pageHeightPx,
    );
    maxBottom = Math.max(
      maxBottom,
      offset + Math.max(...geometry.runs.map((run) => run.y + run.height)) * pane.pageHeightPx,
    );
  }
  if (minTop === Infinity) return { floor: 0, ceil: maxScroll };
  const floor = Math.min(maxScroll, Math.max(0, minTop - TEXT_TOP_MARGIN_PX));
  const ceil = Math.max(
    floor,
    Math.min(maxScroll, maxBottom + TEXT_TOP_MARGIN_PX - scroller.clientHeight),
  );
  return { floor, ceil };
}

function scrollWithinPage(session: Session, direction: "next" | "previous"): boolean {
  if (session.smartArrows === "off") return false;
  const { floor, ceil } = scrollBounds(session);
  if (ceil - floor <= SCROLL_EDGE_EPSILON_PX) return false;
  const down = direction === "next";
  const atEdge = down
    ? session.scroller.scrollTop >= ceil - SCROLL_EDGE_EPSILON_PX
    : session.scroller.scrollTop <= floor + SCROLL_EDGE_EPSILON_PX;
  if (atEdge) return false;
  const target = down
    ? Math.min(ceil, session.scroller.scrollTop + session.scroller.clientHeight)
    : Math.max(floor, session.scroller.scrollTop - session.scroller.clientHeight);
  session.scroller.scrollTo({
    top: target,
    behavior: session.smartArrows === "smooth" ? "smooth" : "auto",
  });
  return true;
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
    session.scroller.dataset.snapshotStatus = "captured";
    void putRenderSnapshot({
      sourceId: session.sourceId,
      kind: "pdf",
      locationKey: `pdf:${session.page}:${total}:${pane.canvas.width}x${pane.canvas.height}`,
      width: pane.canvas.width,
      height: pane.canvas.height,
      dataUrl,
      capturedAt: Date.now(),
    }).then(() => {
      if (!session.released) session.scroller.dataset.snapshotStatus = "persisted";
    });
  } catch {
    // A snapshot is an opening-placeholder optimization; never fail a render for it.
  }
}

function scheduleSnapshot(session: Session, total: number): void {
  if (!session.environment.captureSnapshots) return;
  if (session.snapshotTimer !== null) clearTimeout(session.snapshotTimer);
  const page = session.page;
  session.snapshotTimer = window.setTimeout(() => {
    session.snapshotTimer = null;
    if (!session.released && session.page === page) captureSnapshot(session, total);
  }, 250);
}

function rasterKey(page: number, viewport: PdfViewport, dpr: number, colors: PdfColors): string {
  return [
    page,
    Math.floor(viewport.width * dpr),
    Math.floor(viewport.height * dpr),
    dpr,
    colors.background.toLowerCase(),
    colors.text.toLowerCase(),
  ].join(":");
}

function copyRaster(
  source: HTMLCanvasElement,
  destination: HTMLCanvasElement,
  viewport: Pick<PdfViewport, "width" | "height">,
): boolean {
  const visibility = destination.style.visibility;
  destination.width = source.width;
  destination.height = source.height;
  destination.style.cssText = `width:${viewport.width}px;height:${viewport.height}px;`;
  destination.style.visibility = visibility;
  const context = destination.getContext("2d");
  if (!context) return false;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.drawImage(source, 0, 0);
  return true;
}

function cacheRaster(session: Session, key: string, source: HTMLCanvasElement): void {
  const cached = document.createElement("canvas");
  if (copyRaster(source, cached, { width: source.width, height: source.height })) {
    session.rasterCache.put(key, cached);
  }
}

async function rasterizeVisiblePage(
  session: Session,
  environment: PdfMountEnvironment,
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  viewport: PdfViewport,
  dpr: number,
  themed: boolean,
): Promise<void> {
  const key = rasterKey(page.pageNumber, viewport, dpr, session.colors);
  cancelPrefetchExcept(session, key);
  const prefetched = session.prefetchPromises.get(key);
  if (prefetched) await prefetched;
  const cached = session.rasterCache.get(key);
  if (cached && copyRaster(cached, canvas, viewport)) {
    canvas.dataset.rasterSource = "cache";
    return;
  }

  const task = environment.rasterize({
    page,
    canvas,
    viewport,
    dpr,
    colors: session.colors,
    deferReveal: themed,
  });
  session.renderTasks.add(task);
  try {
    await task.promise;
    canvas.dataset.rasterSource = "render";
    if (environment.prefetchAdjacentPages) cacheRaster(session, key, canvas);
  } finally {
    session.renderTasks.delete(task);
  }
}

async function prefetchPage(
  session: Session,
  environment: PdfMountEnvironment,
  pageNumber: number,
  scale: number,
  dpr: number,
): Promise<void> {
  const doc = session.document;
  if (!doc || session.released) return;
  const page = await doc.getPage(pageNumber);
  if (session.released) return;
  const viewport = page.getViewport({ scale });
  const key = rasterKey(pageNumber, viewport, dpr, session.colors);
  if (session.rasterCache.get(key) || session.prefetching.has(key)) return;
  session.prefetching.add(key);
  const canvas = document.createElement("canvas");
  const task = environment.rasterize({ page, canvas, viewport, dpr, colors: session.colors });
  session.renderTasks.add(task);
  session.prefetchTasks.set(key, task);
  try {
    await task.promise;
    if (!session.released) {
      session.rasterCache.put(key, canvas);
      const ready = new Set([
        ...(session.scroller.dataset.prefetchedPages ?? "")
          .split(",")
          .filter((value) => value !== ""),
        String(pageNumber),
      ]);
      session.scroller.dataset.prefetchedPages = [...ready].join(",");
    }
  } catch {
    // Prefetch is speculative; the foreground render remains the recovery path.
  } finally {
    if (session.prefetchTasks.get(key) === task) {
      session.renderTasks.delete(task);
      session.prefetchTasks.delete(key);
      session.prefetching.delete(key);
    }
  }
}

async function prefetchNeighbors(
  session: Session,
  environment: PdfMountEnvironment,
  renderedPage: number,
): Promise<void> {
  const doc = session.document;
  if (!doc || session.released || !environment.prefetchAdjacentPages) return;
  const step = session.spread ? 2 : 1;
  for (const candidate of [renderedPage + step, renderedPage - step]) {
    if (candidate < 1 || candidate > doc.numPages || session.page !== renderedPage) return;
    const left = spreadStart(candidate, session.spread);
    const pages = spreadPages(left, session.spread, doc.numPages);
    const first = await doc.getPage(pages[0]!);
    if (session.released || session.page !== renderedPage) return;
    const base = first.getViewport({ scale: 1 });
    const gutter = pages.length > 1 ? SPREAD_GUTTER_PX : 0;
    const available = session.scroller.clientWidth || base.width;
    const fit = pages.length > 1 ? (available - gutter) / (2 * base.width) : available / base.width;
    const targetZoom = session.fitToPage
      ? await computeFitZoomAt(session, left, session.spread)
      : session.zoom;
    if (targetZoom === null || session.page !== renderedPage) return;
    const scale = fit * (targetZoom / 100);
    const dpr = Math.min(environment.devicePixelRatio(), MAX_RENDER_DPR);
    for (const pageNumber of pages) {
      if (session.page !== renderedPage) return;
      await prefetchPage(session, environment, pageNumber, scale, dpr);
    }
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
  const themed = !isDefaultPdfColors(session.colors);
  if (themed) {
    // A reused right pane still contains the previous spread while the left
    // page renders. Hide the whole spread up front and reveal it atomically.
    for (const pane of panes) pane.canvas.style.visibility = "hidden";
  }

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
    // Cached pixels can replace a page synchronously; its old transparent text
    // layer must not remain selectable while the matching layer catches up.
    pane.builder?.cancel();
    pane.builder?.div.remove();
    pane.builder = null;
    pane.textLayer = null;
    pane.page = pageNum;

    try {
      await rasterizeVisiblePage(session, environment, page, pane.canvas, viewport, dpr, themed);
    } catch {
      // A cancelled task is the release path doing its job, not a failure.
      return;
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
  if (themed) {
    for (const pane of panes) pane.canvas.style.visibility = "visible";
  }

  const lastPage = pages.at(-1) ?? left;
  session.scroller.dataset.renderedZoom = String(session.zoom);
  session.emit(
    PdfSpreadRendered({
      sourceId: session.sourceId,
      pages,
      total: doc.numPages,
      spread,
      atStart: left <= 1,
      atEnd: lastPage >= doc.numPages,
      percentage: doc.numPages > 0 ? left / doc.numPages : 0,
      zoom: session.zoom,
    }),
  );
  paintAnnotations(session);
  scheduleSnapshot(session, doc.numPages);
  publishPosition(session);
  // The document can be released while speculative page/geometry requests are
  // in flight; foreground navigation remains the recovery path.
  void prefetchNeighbors(session, environment, left).catch(() => {});
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
    session.spread = spreadFits(session.layout, doc.numPages, session.scroller.clientWidth);
    const fitZoom = await computeFitZoom(session);
    if (fitZoom !== null) session.zoom = fitZoom;
    session.emit(
      PdfDocumentReady({
        sourceId: session.sourceId,
        totalPages: doc.numPages,
        title: info?.Title?.trim() || null,
        zoom: session.zoom,
      }),
    );
    await renderSpread(session, environment);
    session.scroller.scrollTop = scrollBounds(session).floor;
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

async function fitSession(
  session: Session,
  environment: PdfMountEnvironment,
): Promise<number | null> {
  const doc = session.document;
  if (!doc || session.released) return null;
  session.fitToPage = true;
  session.spread = spreadFits(session.layout, doc.numPages, session.scroller.clientWidth);
  const zoom = await computeFitZoom(session);
  // Manual zoom can arrive while the page measurements above are in flight.
  // It owns the final value and exits fit mode, so the stale fit must not
  // restore itself after that deliberate choice.
  if (!session.fitToPage) return null;
  if (zoom !== null) session.zoom = zoom;
  await renderSpread(session, environment);
  session.scroller.scrollTop = scrollBounds(session).floor;
  publishPosition(session);
  return zoom;
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
      colors: Schema.Struct({ background: Schema.String, text: Schema.String }),
      smartArrows: SmartArrows,
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
    // A page entered from a turn rests at its origin rather than inheriting
    // panning from a differently sized or cropped page.
    session.scroller.scrollTop = 0;
    session.scroller.scrollLeft = 0;
    return session.fitToPage
      ? fitSession(session, environment).then(() => {})
      : renderSpread(session, environment);
  };

  return {
    Mount: PdfDocument,
    turnPage: (direction: "next" | "previous", requestedZoom = live?.zoom ?? 100) =>
      onLiveSession((session) => {
        // Commands may execute concurrently. A page turn carries the Model's
        // zoom so it cannot overtake a manual zoom and accidentally preserve
        // the old fit-to-page mode.
        const adoptsPendingZoom = requestedZoom !== session.zoom;
        if (adoptsPendingZoom) {
          cancelPrefetch(session);
          session.rasterCache.clear();
          session.scroller.dataset.prefetchedPages = "";
          session.fitToPage = false;
          session.zoom = requestedZoom;
        }
        // The user issued this turn after the Model accepted a zoom step, but
        // its render command has not reached the mount yet. The old page's
        // scroll bounds no longer describe the requested zoom, so do not let
        // those stale bounds consume the page-turn intent.
        if (!adoptsPendingZoom && scrollWithinPage(session, direction)) return;
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
    /** Reframe the current spread around its text. Computing a percentage is
     *  only half of fit-to-page: the live scroller must also land on the text
     *  top after the resized page has established its final DOM geometry. */
    fitToText: Effect.suspend(() => {
      const session = live;
      if (session === null || session.released) return Effect.succeed(null);
      return Effect.promise(() => fitSession(session, environment)).pipe(
        Effect.orElseSucceed(() => null),
      );
    }),
    dismissSelection: Effect.sync(() => {
      globalThis.getSelection?.()?.removeAllRanges();
    }),
    /** A PDF page is baked pixels, not a stylesheet, so a theme change has
     *  nothing to re-flow — only a re-render can repaint it. The reader
     *  keeps its scroll position because `renderSpread` redraws the same
     *  page in place rather than reopening the document. */
    setColors: (colors: PdfColors) =>
      onLiveSession((session) => {
        cancelPrefetch(session);
        session.rasterCache.clear();
        session.scroller.dataset.prefetchedPages = "";
        session.colors = colors;
        return renderSpread(session, environment);
      }),
    setZoom: (zoom: number) =>
      onLiveSession((session) => {
        session.fitToPage = false;
        if (session.zoom === zoom) return;
        cancelPrefetch(session);
        session.rasterCache.clear();
        session.scroller.dataset.prefetchedPages = "";
        session.zoom = zoom;
        return renderSpread(session, environment);
      }),
    setSmartArrows: (smartArrows: SmartArrows) =>
      Effect.sync(() => {
        if (live !== null) live.smartArrows = smartArrows;
      }),
  };
};

export type PdfMountAdapter = ReturnType<typeof makePdfMount>;
