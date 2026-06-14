import type * as PdfjsModule from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
// Vite resolves this to the hashed worker bundle URL.
// oxlint-disable-next-line import/default
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

// PDF.js is lazily loaded on demand
let pdfjsPromise: Promise<typeof PdfjsModule> | null = null;
function pdfjsLib(): Promise<typeof PdfjsModule> {
  pdfjsPromise ??= import("pdfjs-dist").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = workerUrl;
    return lib;
  });
  return pdfjsPromise;
}

export async function loadTextLayerCtor(): Promise<typeof PdfjsModule.TextLayer> {
  return (await pdfjsLib()).TextLayer;
}

export function isPasswordException(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "PasswordException"
  );
}

// Positioned text run from PDF.js.
export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

// Open a PDF document from raw bytes.
export async function loadPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await pdfjsLib();
  return pdfjs.getDocument({ data }).promise;
}

export async function destroyPdf(doc: PDFDocumentProxy): Promise<void> {
  await doc.loadingTask.destroy();
}

// Extract the positioned text items on a page.
export async function pageTextItems(page: PDFPageProxy): Promise<PdfTextItem[]> {
  const content = await page.getTextContent();
  return content.items.flatMap((item) =>
    "str" in item
      ? [{ str: item.str, transform: item.transform, width: item.width, height: item.height }]
      : [],
  );
}

export async function pageText(page: PDFPageProxy): Promise<string> {
  return (await pageTextItems(page)).map((item) => item.str).join("");
}

// Text run in normalized page coordinates, with its start offset in the page text.
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

// Extract a page's text plus normalized geometry.
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

// Get the rectangles that cover a character range
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

// Render a page to a JPEG thumbnail.
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
