import type { SourceHealth } from "../../shared/types/sourceHealth.ts";

export type InspectionProgress = (fraction: number) => void;

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

export interface SourceInspectionResult {
  health: SourceHealth;
  metadata: SourceMetadata;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as string));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("read_failed")));
    reader.readAsDataURL(blob);
  });
}
