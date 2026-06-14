import ePub from "epubjs";
import { healthError, healthOk, type SourceCapabilities } from "../../shared/types/sourceHealth.ts";
import {
  blobToDataUrl,
  EMPTY_METADATA,
  type InspectionProgress,
  type SourceInspectionResult,
  type SourceMetadata,
} from "./inspection.ts";

// EPUB capabilities are uniform: epub.js gives selectable text, CFI anchors,
// quote rebind across spine sections, and spine navigation. There are no rect
// anchors (that's a PDF concept).
const EPUB_CAPABILITIES: SourceCapabilities = {
  selectableText: true,
  textAnchors: true,
  rectAnchors: false,
  quoteRebind: true,
  pageNavigation: true,
};

// A spine section that can be loaded into a document and unloaded again. epub.js
// types this loosely, so we narrow to just what the word counter touches.
interface SpineSection {
  load: (request: unknown) => Promise<{ textContent?: string | null } | null>;
  unload: () => void;
}

// Count the words across every spine section by loading each one's text with the
// same loader the reader uses, then unloading it. Best-effort: returns null if
// anything goes wrong, since the count is informational only.
async function countWords(
  book: ReturnType<typeof ePub>,
  sections: SpineSection[],
  onProgress?: InspectionProgress,
): Promise<number> {
  let words = 0;
  for (const [index, section] of sections.entries()) {
    const contents = await section.load(book.load.bind(book));
    const text = (contents?.textContent ?? "").trim();
    if (text !== "") words += text.split(/\s+/u).length;
    section.unload();
    onProgress?.((index + 1) / sections.length);
  }
  return words;
}

// Extract the cover image as a self-contained data URL. epub.js mints an object
// URL backed by the archive, which is revoked on destroy, so we read its bytes
// into a data URL that survives. Best-effort: null when the book has no cover.
async function coverDataUrl(book: ReturnType<typeof ePub>): Promise<string | null> {
  const url = await book.coverUrl().catch(() => null);
  if (!url) return null;
  const blob = await fetch(url)
    .then((r) => r.blob())
    .catch(() => null);
  return blob ? blobToDataUrl(blob).catch(() => null) : null;
}

// Health-check an EPUB by actually opening it with the same parser the reader
// uses, and confirming it has a non-empty spine. A file that fails to parse or
// has no readable sections cannot host anchored notes. Parsed bibliographic
// metadata (title/author) and a word count from scanning every section ride
// along so the uploader can preview the book and persist a human-readable label.
// `onProgress` tracks the section scan, which dominates the inspection time.
export async function inspectEpub(
  file: File,
  onProgress?: InspectionProgress,
): Promise<SourceInspectionResult> {
  const book = ePub();
  try {
    await book.open(await file.arrayBuffer(), "binary");
    await book.loaded.spine;
    const items = (book.spine as unknown as { spineItems?: SpineSection[] }).spineItems ?? [];
    if (items.length === 0) {
      return {
        health: healthError([
          { code: "parse_failed", message: "The EPUB has no readable sections." },
        ]),
        metadata: EMPTY_METADATA,
      };
    }
    const meta = await book.loaded.metadata.catch(() => null);
    const wordCount = await countWords(book, items, onProgress).catch(() => null);
    const cover = await coverDataUrl(book);
    const metadata: SourceMetadata = {
      title: meta?.title?.trim() || null,
      author: meta?.creator?.trim() || null,
      wordCount,
      cover,
    };
    return { health: healthOk(EPUB_CAPABILITIES), metadata };
  } catch {
    return {
      health: healthError([{ code: "parse_failed", message: "This EPUB could not be opened." }]),
      metadata: EMPTY_METADATA,
    };
  } finally {
    book.destroy();
  }
}
