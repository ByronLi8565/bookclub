import { contentTypeFor, sourceKindFor, type SourceKind } from "../../shared/types/sources.ts";
import type { SourceHealth } from "../../shared/types/sourceHealth.ts";
import { inspectEpub } from "./epubHealth.ts";
import { inspectPdf } from "./pdfHealth.ts";

// Pre-upload source health, run client-side before the file is sent (Option A).
// The UI renders the result: `ok` uploads immediately, `warn` asks for
// confirmation, `error` refuses. The health check uses the same parser/anchor
// path the runtime reader uses, so it tests the interface real highlights need.
export type SourceInspection =
  | { ok: true; kind: SourceKind; contentType: string; health: SourceHealth }
  | { ok: false; reason: "unsupported_type" | "read_failed" };

export async function inspectSource(file: File): Promise<SourceInspection> {
  const kind = sourceKindFor(file.type, file.name);
  if (!kind) return { ok: false, reason: "unsupported_type" };
  try {
    const health = kind === "epub" ? await inspectEpub(file) : await inspectPdf(file);
    return { ok: true, kind, contentType: contentTypeFor(kind), health };
  } catch {
    return { ok: false, reason: "read_failed" };
  }
}
