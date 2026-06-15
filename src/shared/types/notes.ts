export interface NoteAuthor {
  id: string;
  name: string;
}

export interface Note {
  id: string;
  seq: number;
  sourceId: string;
  author: NoteAuthor;
  parent: string | null;
  body: string;
  highlights: Highlight[];
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  version: number;
}

export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type HighlightAnchor =
  | { kind: "epub-cfi"; value: string }
  | { kind: "pdf-text"; page: number; rects: PdfRect[] };

export interface QuoteSelector {
  type: "TextQuoteSelector";
  exact: string;
  prefix: string;
  suffix: string;
}

export interface Highlight {
  id: string;
  sourceId: string;
  anchor: HighlightAnchor;
  quote: QuoteSelector;
  createdAt: string;
}

export function epubAnchor(value: string): HighlightAnchor {
  return { kind: "epub-cfi", value };
}

export function pdfAnchor(page: number, rects: PdfRect[]): HighlightAnchor {
  return { kind: "pdf-text", page, rects };
}
