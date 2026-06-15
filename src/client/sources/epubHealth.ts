import ePub from "epubjs";
import { healthError, healthOk, type SourceCapabilities } from "../../shared/types/sourceHealth.ts";
import {
  blobToDataUrl,
  EMPTY_METADATA,
  type InspectionProgress,
  type SourceInspectionResult,
  type SourceMetadata,
} from "./inspection.ts";

const EPUB_CAPABILITIES: SourceCapabilities = {
  selectableText: true,
  textAnchors: true,
  rectAnchors: false,
  quoteRebind: true,
  pageNavigation: true,
};

interface SpineSection {
  load: (request: unknown) => Promise<{ textContent?: string | null } | null>;
  unload: () => void;
}

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

async function coverDataUrl(book: ReturnType<typeof ePub>): Promise<string | null> {
  const url = await book.coverUrl().catch(() => null);
  if (!url) return null;
  const blob = await fetch(url)
    .then((r) => r.blob())
    .catch(() => null);
  return blob ? blobToDataUrl(blob).catch(() => null) : null;
}

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
