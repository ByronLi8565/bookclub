import type { PDFDocumentProxy } from "../../../logic/sources/pdf.ts";

interface CachedPdfDocument {
  doc: PDFDocumentProxy;
  bytes: number;
  lastUsedAt: number;
}

const MAX_PDF_DOCUMENTS = 3;
const MAX_PDF_BYTES = 250 * 1024 * 1024;

const pdfDocuments = new Map<string, CachedPdfDocument>();

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
