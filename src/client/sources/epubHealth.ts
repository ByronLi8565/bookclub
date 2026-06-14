import ePub from "epubjs";
import {
  healthError,
  healthOk,
  type SourceCapabilities,
  type SourceHealth,
} from "../../shared/types/sourceHealth.ts";

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

// Health-check an EPUB by actually opening it with the same parser the reader
// uses, and confirming it has a non-empty spine. A file that fails to parse or
// has no readable sections cannot host anchored notes.
export async function inspectEpub(file: File): Promise<SourceHealth> {
  const book = ePub();
  try {
    await book.open(await file.arrayBuffer(), "binary");
    await book.loaded.spine;
    const items = (book.spine as unknown as { spineItems?: unknown[] }).spineItems ?? [];
    if (items.length === 0) {
      return healthError([{ code: "parse_failed", message: "The EPUB has no readable sections." }]);
    }
    return healthOk(EPUB_CAPABILITIES);
  } catch {
    return healthError([{ code: "parse_failed", message: "This EPUB could not be opened." }]);
  } finally {
    book.destroy();
  }
}
