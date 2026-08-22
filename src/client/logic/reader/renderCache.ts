import type { PDFDocumentProxy } from "../sources/pdf.ts";

interface CachedPdfDocument {
  doc: PDFDocumentProxy;
  bytes: number;
  lastUsedAt: number;
}

const MAX_PDF_DOCUMENTS = 3;
const MAX_PDF_BYTES = 250 * 1024 * 1024;
const MAX_PDF_RASTER_BYTES = 128 * 1024 * 1024;

const pdfDocuments = new Map<string, CachedPdfDocument>();

interface CachedPdfRaster {
  canvas: HTMLCanvasElement;
  bytes: number;
}

/** Session-local completed page pixels. Unlike the document cache above this
 * is intentionally not shared across readers: its keys contain viewport,
 * scale, DPR, and theme state, all of which belong to one live surface. */
export class PdfRasterCache {
  readonly #rasters = new Map<string, CachedPdfRaster>();
  #bytes = 0;

  get(key: string): HTMLCanvasElement | null {
    const cached = this.#rasters.get(key);
    if (!cached) return null;
    this.#rasters.delete(key);
    this.#rasters.set(key, cached);
    return cached.canvas;
  }

  put(key: string, canvas: HTMLCanvasElement): void {
    const existing = this.#rasters.get(key);
    if (existing) {
      this.#bytes -= existing.bytes;
      this.#rasters.delete(key);
      existing.canvas.width = 0;
      existing.canvas.height = 0;
    }
    const bytes = canvas.width * canvas.height * 4;
    if (bytes === 0 || bytes > MAX_PDF_RASTER_BYTES) return;
    this.#rasters.set(key, { canvas, bytes });
    this.#bytes += bytes;
    while (this.#bytes > MAX_PDF_RASTER_BYTES) {
      const oldest = this.#rasters.entries().next().value;
      if (!oldest) break;
      const [oldestKey, raster] = oldest;
      this.#rasters.delete(oldestKey);
      this.#bytes -= raster.bytes;
      raster.canvas.width = 0;
      raster.canvas.height = 0;
    }
  }

  clear(): void {
    for (const { canvas } of this.#rasters.values()) {
      canvas.width = 0;
      canvas.height = 0;
    }
    this.#rasters.clear();
    this.#bytes = 0;
  }
}

export function getCachedPdfDocument(sourceId: string): PDFDocumentProxy | null {
  const cached = pdfDocuments.get(sourceId);
  if (!cached) return null;
  cached.lastUsedAt = performance.now();
  return cached.doc;
}

export function putCachedPdfDocument(sourceId: string, doc: PDFDocumentProxy, bytes: number): void {
  const existing = pdfDocuments.get(sourceId);
  if (existing && existing.doc !== doc) void existing.doc.loadingTask.destroy();
  pdfDocuments.set(sourceId, { doc, bytes, lastUsedAt: performance.now() });
  prunePdfDocuments();
}

export function hasCachedPdfDocument(sourceId: string, doc: PDFDocumentProxy): boolean {
  return pdfDocuments.get(sourceId)?.doc === doc;
}

function prunePdfDocuments(): void {
  let totalBytes = [...pdfDocuments.values()].reduce((sum, cached) => sum + cached.bytes, 0);
  const oldest = () =>
    [...pdfDocuments.entries()].toSorted((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)[0] ?? null;

  while (pdfDocuments.size > MAX_PDF_DOCUMENTS || totalBytes > MAX_PDF_BYTES) {
    const entry = oldest();
    if (!entry) return;
    const [sourceId, cached] = entry;
    pdfDocuments.delete(sourceId);
    totalBytes -= cached.bytes;
    void cached.doc.loadingTask.destroy();
  }
}
