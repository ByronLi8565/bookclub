import {
  healthError,
  healthOk,
  healthWarn,
  type SourceCapabilities,
  type SourceHealthIssue,
} from "../../shared/types/sourceHealth.ts";
import {
  EMPTY_METADATA,
  type InspectionProgress,
  type SourceInspectionResult,
  type SourceMetadata,
} from "./inspection.ts";
import {
  destroyPdf,
  isPasswordException,
  loadPdf,
  pageTextItems,
  renderPageThumbnail,
} from "./pdf.ts";

// PDF metadata fields we surface.
interface PdfInfo {
  Title?: string;
  Author?: string;
}

// Capabilities for a PDF with a usable text layer.
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

// Health-check a PDF by parsing every page and verifying the text layer.
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
