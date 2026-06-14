import type { SourceHealth } from "../../shared/types/sourceHealth.ts";

// Inspection progress fraction [0, 1].
export type InspectionProgress = (fraction: number) => void;

// Parsed bibliographic metadata from an inspected file.
export interface SourceMetadata {
  title: string | null;
  author: string | null;
  wordCount: number | null;
  cover: string | null;
}

export const EMPTY_METADATA: SourceMetadata = {
  title: null,
  author: null,
  wordCount: null,
  cover: null,
};

// Health verdict plus parsed metadata for an inspected file.
export interface SourceInspectionResult {
  health: SourceHealth;
  metadata: SourceMetadata;
}

// Read a blob into a data URL.
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as string));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("read_failed")));
    reader.readAsDataURL(blob);
  });
}
