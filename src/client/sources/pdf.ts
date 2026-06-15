import type * as PdfjsModule from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type * as PdfViewerModule from "pdfjs-dist/web/pdf_viewer.mjs";
import type { TextLayerBuilder } from "pdfjs-dist/web/pdf_viewer.mjs";
import {
  healthError,
  healthOk,
  healthWarn,
  type SourceCapabilities,
  type SourceHealthIssue,
} from "../../shared/types/sourceHealth.ts";
import type { InspectionProgress, SourceInspectionResult, SourceMetadata } from "./checkHealth.ts";

// oxlint-disable-next-line import/default
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

let pdfjsPromise: Promise<typeof PdfjsModule> | null = null;
let viewerPromise: Promise<typeof PdfViewerModule> | null = null;

const EMPTY_METADATA: SourceMetadata = { title: null, author: null, wordCount: null, cover: null };

const TEXT_CAPABILITIES: SourceCapabilities = {
  selectableText: true,
  textAnchors: true,
  rectAnchors: true,
  quoteRebind: true,
  pageNavigation: true,
};

const LARGE_FILE_BYTES = 50 * 1024 * 1024;
const LOW_COVERAGE = 0.8;
const BAD_ENCODING = 0.02;

interface PdfInfo {
  Title?: string;
  Author?: string;
}

function pdfjsLib(): Promise<typeof PdfjsModule> {
  pdfjsPromise ??= import("pdfjs-dist").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = workerUrl;
    return lib;
  });
  return pdfjsPromise;
}

// The viewer components (TextLayerBuilder et al.) read their pdf.js primitives
// from `globalThis.pdfjsLib` at import time, so we must publish the *same* core
// instance there before importing the viewer. This keeps a single pdf.js copy,
// so `viewport instanceof PageViewport` and the page-proxy APIs line up.
export async function loadTextLayerBuilderCtor(): Promise<typeof TextLayerBuilder> {
  const lib = await pdfjsLib();
  (globalThis as { pdfjsLib?: typeof PdfjsModule }).pdfjsLib = lib;
  viewerPromise ??= import("pdfjs-dist/web/pdf_viewer.mjs");
  return (await viewerPromise).TextLayerBuilder;
}

export function isPasswordException(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "PasswordException"
  );
}

export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

export async function loadPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await pdfjsLib();
  return pdfjs.getDocument({ data }).promise;
}

export async function destroyPdf(doc: PDFDocumentProxy): Promise<void> {
  await doc.loadingTask.destroy();
}

export async function pageTextItems(page: PDFPageProxy): Promise<PdfTextItem[]> {
  const content = await page.getTextContent();
  return content.items.flatMap((item) =>
    "str" in item
      ? [{ str: item.str, transform: item.transform, width: item.width, height: item.height }]
      : [],
  );
}

export async function pageText(page: PDFPageProxy): Promise<string> {
  return joinPdfTextItems(await pageTextItems(page)).text;
}

function shouldInsertBoundarySpace(text: string, next: string): boolean {
  return text.length > 0 && next.length > 0 && /\S$/u.test(text) && /^\S/u.test(next);
}

function joinPdfTextItems(items: PdfTextItem[]): { text: string; starts: number[] } {
  const starts: number[] = [];
  let text = "";
  for (const item of items) {
    if (shouldInsertBoundarySpace(text, item.str)) text += " ";
    starts.push(text.length);
    text += item.str;
  }
  return { text, starts };
}

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

export async function pageGeometry(page: PDFPageProxy): Promise<PageGeometry> {
  const { width, height } = page.getViewport({ scale: 1 });
  const items = await pageTextItems(page);
  const joined = joinPdfTextItems(items);
  const runs: PageTextRun[] = [];
  for (const [index, item] of items.entries()) {
    const start = joined.starts[index] ?? 0;
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
  return { text: joined.text, runs };
}

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

export async function inspectPdf(
  file: File,
  onProgress?: InspectionProgress,
): Promise<SourceInspectionResult> {
  let doc;
  try {
    doc = await loadPdf(await file.arrayBuffer());
  } catch (error) {
    if (isPasswordException(error)) {
      return {
        health: healthError([{ code: "encrypted", message: "This PDF is password-protected." }]),
        metadata: EMPTY_METADATA,
      };
    }
    return {
      health: healthError([{ code: "parse_failed", message: "This PDF could not be opened." }]),
      metadata: EMPTY_METADATA,
    };
  }

  try {
    const meta = await doc.getMetadata().catch(() => null);
    const info = meta?.info as PdfInfo | undefined;
    const cover = await doc
      .getPage(1)
      .then((page) => renderPageThumbnail(page))
      .catch(() => null);
    const metadata: SourceMetadata = {
      title: info?.Title?.trim() || null,
      author: info?.Author?.trim() || null,
      wordCount: null,
      cover,
    };
    const numPages = doc.numPages;

    let pagesWithText = 0;
    let pagesWithGeometry = 0;
    let totalChars = 0;
    let replacementChars = 0;

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const items = await pageTextItems(page);
      const text = items.map((i) => i.str).join("");
      if (text.trim() !== "") pagesWithText++;
      if (items.some((i) => i.transform.length >= 6 && (i.width > 0 || i.height > 0))) {
        pagesWithGeometry++;
      }
      totalChars += text.length;
      replacementChars += (text.match(/\uFFFD/gu) ?? []).length;
      page.cleanup();
      onProgress?.(pageNum / numPages);
    }

    if (pagesWithText === 0) {
      return {
        health: healthError([
          { code: "no_text_layer", message: "This PDF has no selectable text (it looks scanned)." },
        ]),
        metadata,
      };
    }
    if (pagesWithGeometry === 0) {
      return {
        health: healthError([
          { code: "anchor_capture_failed", message: "Text in this PDF has no position data." },
        ]),
        metadata,
      };
    }

    const warnings: SourceHealthIssue[] = [];
    const coverage = pagesWithText / numPages;
    if (coverage < 1 && coverage >= LOW_COVERAGE) {
      warnings.push({
        code: "mixed_page_support",
        message: "Some pages have no selectable text; highlights won't work there.",
      });
    } else if (coverage < LOW_COVERAGE) {
      warnings.push({
        code: "low_text_coverage",
        message: "Most pages have little or no selectable text.",
      });
    }
    if (totalChars > 0 && replacementChars / totalChars > BAD_ENCODING) {
      warnings.push({
        code: "unusual_text_encoding",
        message: "Text extraction looks unreliable; some highlights may not rebind.",
      });
    }
    if (file.size > LARGE_FILE_BYTES) {
      warnings.push({
        code: "large_file",
        message: "This is a large PDF and may be slow to load.",
      });
    }

    const health =
      warnings.length > 0 ? healthWarn(TEXT_CAPABILITIES, warnings) : healthOk(TEXT_CAPABILITIES);
    return { health, metadata };
  } finally {
    void destroyPdf(doc);
  }
}
