import ePub from "epubjs";
import { healthError, healthOk, type SourceCapabilities } from "../../shared/types/sourceHealth.ts";
import type { InspectionProgress, SourceInspectionResult, SourceMetadata } from "./checkHealth.ts";

const EMPTY_METADATA: SourceMetadata = { title: null, author: null, wordCount: null, cover: null };

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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as string));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("read_failed")));
    reader.readAsDataURL(blob);
  });
}

async function countWords(
  book: ReturnType<typeof ePub>,
  sections: SpineSection[],
  onProgress?: InspectionProgress,
): Promise<number> {
  let inspected = 0;
  const counts = await Promise.all(
    sections.map(async (section) => {
      try {
        const contents = await section.load(book.load.bind(book));
        const text = (contents?.textContent ?? "").trim();
        return text === "" ? 0 : text.split(/\s+/u).length;
      } finally {
        section.unload();
        inspected++;
        onProgress?.(inspected / sections.length);
      }
    }),
  );
  return counts.reduce((total, count) => total + count, 0);
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
    const [meta, wordCount, cover] = await Promise.all([
      book.loaded.metadata.catch(() => null),
      countWords(book, items, onProgress).catch(() => null),
      coverDataUrl(book),
    ]);
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
