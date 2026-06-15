import { contentTypeFor, sourceKindFor, type SourceKind } from "../../shared/types/sources.ts";
import type { SourceHealth } from "../../shared/types/sourceHealth.ts";
import { inspectEpub } from "./epub.ts";
import { inspectPdf } from "./pdf.ts";

export type InspectionProgress = (fraction: number) => void;

export interface SourceMetadata {
  title: string | null;
  author: string | null;
  wordCount: number | null;
  cover: string | null;
}

export interface SourceInspectionResult {
  health: SourceHealth;
  metadata: SourceMetadata;
}

export type SourceInspection =
  | {
      ok: true;
      kind: SourceKind;
      contentType: string;
      health: SourceHealth;
      metadata: SourceMetadata;
    }
  | { ok: false; reason: "unsupported_type" | "read_failed" };

export async function inspectSource(
  file: File,
  onProgress?: InspectionProgress,
): Promise<SourceInspection> {
  const kind = sourceKindFor(file.type, file.name);
  if (!kind) return { ok: false, reason: "unsupported_type" };
  try {
    const { health, metadata } =
      kind === "epub" ? await inspectEpub(file, onProgress) : await inspectPdf(file, onProgress);
    return { ok: true, kind, contentType: contentTypeFor(kind), health, metadata };
  } catch {
    return { ok: false, reason: "read_failed" };
  }
}
