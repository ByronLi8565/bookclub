import type * as PdfjsModule from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
// Vite resolves this to a hashed URL for the worker bundle. This is a tiny
// string constant, not the library itself, so it stays a static import.
// oxlint-disable-next-line import/default
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

// PDF.js is ~1.2 MB, so it is loaded on demand — only when a PDF is actually
// inspected or opened — rather than bundled into the main chunk that every
// (EPUB-only) club pays for. The module is cached after the first import and
// its worker is wired up once.
let pdfjsPromise: Promise<typeof PdfjsModule> | null = null;
function pdfjsLib(): Promise<typeof PdfjsModule> {
  pdfjsPromise ??= import("pdfjs-dist").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = workerUrl;
    return lib;
  });
  return pdfjsPromise;
}

// The TextLayer constructor, loaded lazily with the rest of PDF.js.
export async function loadTextLayerCtor(): Promise<typeof PdfjsModule.TextLayer> {
  return (await pdfjsLib()).TextLayer;
}

// Raised by PDF.js when a document is password-protected.
export function isPasswordException(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "PasswordException"
  );
}

// One positioned text run on a page. `transform` is the PDF.js text matrix
// [a, b, c, d, e, f]; e/f are the run's origin in PDF user space.
export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

// Open a PDF document from raw bytes. The caller owns destroying it via
// `destroyPdf` (which tears down the worker), not the document's `cleanup`.
export async function loadPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await pdfjsLib();
  return pdfjs.getDocument({ data }).promise;
}

// Fully release a loaded document and its worker.
export async function destroyPdf(doc: PDFDocumentProxy): Promise<void> {
  await doc.loadingTask.destroy();
}

// Extract the positioned text items on a page (dropping marked-content markers,
// which carry no geometry).
export async function pageTextItems(page: PDFPageProxy): Promise<PdfTextItem[]> {
  const content = await page.getTextContent();
  return content.items.flatMap((item) =>
    "str" in item
      ? [{ str: item.str, transform: item.transform, width: item.width, height: item.height }]
      : [],
  );
}

// The page's plain text, joined in extraction order.
export async function pageText(page: PDFPageProxy): Promise<string> {
  return (await pageTextItems(page)).map((item) => item.str).join("");
}

// One text run, positioned in normalized page coordinates (0..1, origin
// top-left so it matches DOM rects), plus where it starts in the page's
// concatenated text. Used to rebuild rect anchors from a text offset without
// rendering the page.
export interface PageTextRun {
  str: string;
  start: number; // char offset within the page's concatenated text
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageGeometry {
  text: string;
  runs: PageTextRun[];
}

// Extract a page's text plus per-run normalized geometry, deriving positions
// from the PDF.js text matrix at scale 1. PDF user space is origin bottom-left;
// these are converted to top-left so they align with DOM client rects.
export async function pageGeometry(page: PDFPageProxy): Promise<PageGeometry> {
  const { width, height } = page.getViewport({ scale: 1 });
  const items = await pageTextItems(page);
  const runs: PageTextRun[] = [];
  let text = "";
  for (const item of items) {
    const start = text.length;
    text += item.str;
    const baselineX = item.transform[4] ?? 0;
    const baselineY = item.transform[5] ?? 0;
    const h = item.height || Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0);
    runs.push({
      str: item.str,
      start,
      x: baselineX / width,
      y: (height - baselineY - h) / height,
      width: item.width / width,
      height: h / height,
    });
  }
  return { text, runs };
}

// The normalized rects covering a [start, end) character range within a page's
// concatenated text: one rect per overlapping run.
export function rectsForRange(
  geometry: PageGeometry,
  start: number,
  end: number,
): { x: number; y: number; width: number; height: number }[] {
  return geometry.runs.flatMap((run) => {
    const runEnd = run.start + run.str.length;
    if (runEnd <= start || run.start >= end) return [];
    return [{ x: run.x, y: run.y, width: run.width, height: run.height }];
  });
}

// Render a page to a JPEG data URL no wider than `maxWidth`, for use as a cover
// thumbnail. Best-effort: returns null if the canvas context is unavailable.
export async function renderPageThumbnail(
  page: PDFPageProxy,
  maxWidth = 240,
): Promise<string | null> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(1, maxWidth / base.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) return null;
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.8);
}
