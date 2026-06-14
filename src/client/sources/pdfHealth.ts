import {
  healthError,
  healthOk,
  healthWarn,
  type SourceCapabilities,
  type SourceHealth,
  type SourceHealthIssue,
} from "../../shared/types/sourceHealth.ts";
import { destroyPdf, isPasswordException, loadPdf, pageTextItems, samplePages } from "./pdf.ts";

// A PDF with a usable text layer supports everything; an image-only PDF supports
// none of the text-based capabilities and is rejected.
const TEXT_CAPABILITIES: SourceCapabilities = {
  selectableText: true,
  textAnchors: true,
  rectAnchors: true,
  quoteRebind: true,
  pageNavigation: true,
};

// A file this large warns the owner (download/parse cost), measured in bytes.
const LARGE_FILE_BYTES = 50 * 1024 * 1024;
// Below this fraction of sampled pages carrying text, warn about low coverage.
const LOW_COVERAGE = 0.5;
// Fraction of replacement chars above which extraction looks unreliable.
const BAD_ENCODING = 0.1;

// Health-check a PDF with the same parser the reader uses. Confirms it parses,
// is not encrypted, has an extractable text layer with usable geometry across
// sampled pages, and classifies risk via warnings. An image-only PDF fails with
// `no_text_layer` (it would need OCR to host text highlights).
export async function inspectPdf(file: File): Promise<SourceHealth> {
  let doc;
  try {
    doc = await loadPdf(await file.arrayBuffer());
  } catch (error) {
    if (isPasswordException(error)) {
      return healthError([{ code: "encrypted", message: "This PDF is password-protected." }]);
    }
    return healthError([{ code: "parse_failed", message: "This PDF could not be opened." }]);
  }

  try {
    const numPages = doc.numPages;
    const pages = samplePages(numPages);

    let pagesWithText = 0;
    let pagesWithGeometry = 0;
    let totalChars = 0;
    let replacementChars = 0;

    for (const pageNum of pages) {
      const page = await doc.getPage(pageNum);
      const items = await pageTextItems(page);
      const text = items.map((i) => i.str).join("");
      if (text.trim() !== "") pagesWithText++;
      if (items.some((i) => i.transform.length >= 6 && (i.width > 0 || i.height > 0))) {
        pagesWithGeometry++;
      }
      totalChars += text.length;
      replacementChars += (text.match(/\uFFFD/gu) ?? []).length;
    }

    // No text on any sampled page: image-only / scanned. Cannot anchor notes.
    if (pagesWithText === 0) {
      return healthError([
        { code: "no_text_layer", message: "This PDF has no selectable text (it looks scanned)." },
      ]);
    }
    // Text exists but lacks geometry: cannot build rect anchors.
    if (pagesWithGeometry === 0) {
      return healthError([
        { code: "anchor_capture_failed", message: "Text in this PDF has no position data." },
      ]);
    }

    const warnings: SourceHealthIssue[] = [];
    const coverage = pagesWithText / pages.length;
    if (coverage < 1 && coverage >= LOW_COVERAGE) {
      warnings.push({
        code: "mixed_page_support",
        message: "Some pages have no selectable text; highlights won't work there.",
      });
    } else if (coverage < LOW_COVERAGE) {
      warnings.push({
        code: "low_text_coverage",
        message: "Most sampled pages have little or no selectable text.",
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

    return warnings.length > 0
      ? healthWarn(TEXT_CAPABILITIES, warnings)
      : healthOk(TEXT_CAPABILITIES);
  } finally {
    void destroyPdf(doc);
  }
}
