// Shared source (readable material) types. A club binds one current source for
// v1; EPUB and PDF sit behind this one model so callers never branch on format
// except where the copy genuinely differs.

export type SourceKind = "epub" | "pdf";

export const EPUB_CONTENT_TYPE = "application/epub+zip";
export const PDF_CONTENT_TYPE = "application/pdf";

// A bare reference to a stored source: its content hash plus how to read it.
export interface SourceRef {
  id: string; // content hash
  kind: SourceKind;
  contentType: string;
}

// A source plus the metadata a club needs to list and label it.
export interface SourceSummary extends SourceRef {
  title: string | null; // member override or parsed metadata title
  size: number; // bytes
}

// Map a content type (and optional filename) to a source kind, or null if the
// type is not a supported readable source.
export function sourceKindFor(contentType: string | null, filename?: string): SourceKind | null {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase();
  if (type === EPUB_CONTENT_TYPE) return "epub";
  if (type === PDF_CONTENT_TYPE) return "pdf";
  const ext = filename?.toLowerCase().split(".").pop();
  if (ext === "epub") return "epub";
  if (ext === "pdf") return "pdf";
  return null;
}

export function contentTypeFor(kind: SourceKind): string {
  return kind === "epub" ? EPUB_CONTENT_TYPE : PDF_CONTENT_TYPE;
}

export function extensionFor(kind: SourceKind): string {
  return kind === "epub" ? "epub" : "pdf";
}

// Identify a source kind from the leading magic bytes, independent of any
// client-supplied content type. EPUB is a ZIP container ("PK\x03\x04"); PDF
// starts with "%PDF-". Returns null when the signature matches neither.
export function sniffSourceKind(bytes: ArrayBuffer): SourceKind | null {
  const head = new Uint8Array(bytes.slice(0, 5));
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return "pdf"; // %PDF
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return "epub"; // PK..
  return null;
}
