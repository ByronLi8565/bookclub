export type SourceKind = "epub" | "pdf";

export const EPUB_CONTENT_TYPE = "application/epub+zip";
const PDF_CONTENT_TYPE = "application/pdf";

export interface SourceRef {
  id: string;
  kind: SourceKind;
  contentType: string;
}

export interface SourceSummary extends SourceRef {
  title: string | null;
  size: number;
}

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

export function sniffSourceKind(bytes: ArrayBuffer): SourceKind | null {
  const head = new Uint8Array(bytes.slice(0, 5));
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return "pdf"; // %PDF
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return "epub"; // PK..
  return null;
}
