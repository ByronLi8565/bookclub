import type { SourceHealth } from "../../shared/types/sourceHealth.ts";

// Reports inspection progress as a fraction in [0, 1]. Inspecting scans the
// entire file (every PDF page / EPUB section), so the uploader drives a progress
// bar off this rather than showing an indefinite spinner.
export type InspectionProgress = (fraction: number) => void;

// Parsed bibliographic metadata pulled from a file during inspection, shown on
// the upload screen. Every field is best-effort: any of them is null when the
// file doesn't carry it. `title` doubles as the book's default label.
//
// These types and the empty constant live in their own module (not admission)
// so the per-kind inspectors can import the runtime constant without forming an
// import cycle with admission, which imports the inspectors.
export interface SourceMetadata {
  title: string | null;
  author: string | null;
  wordCount: number | null;
  // A cover thumbnail as a data URL (the EPUB cover image, or the PDF's rendered
  // first page), or null when none could be produced.
  cover: string | null;
}

export const EMPTY_METADATA: SourceMetadata = {
  title: null,
  author: null,
  wordCount: null,
  cover: null,
};

// What a per-kind inspector returns: the health verdict plus the parsed
// bibliographic metadata, so the uploader can preview the book and persist a
// human-readable label alongside the bytes.
export interface SourceInspectionResult {
  health: SourceHealth;
  metadata: SourceMetadata;
}

// Read a blob into a data URL (e.g. to turn an extracted cover image into a
// self-contained thumbnail that outlives the parser instance).
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as string));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("read_failed")));
    reader.readAsDataURL(blob);
  });
}
