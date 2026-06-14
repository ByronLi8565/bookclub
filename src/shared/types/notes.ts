// Shared note and highlight models. These are imported by both the client
// renderer and the server's durable-object state machine, so they live in a
// dependency-free shared module.

export interface NoteAuthor {
  id: string;
  name: string;
}

export interface Note {
  id: string; // server ULID (sortable, monotonic per book)
  seq: number; // human-readable per-book number
  sourceId: string; // the hash of the source this note belongs to
  author: NoteAuthor;
  parent: string | null; // another note id for replies; null for top-level notes
  body: string; // markdown serialized from Lexical
  highlights: Highlight[];
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  version: number;
}

// A rectangle on a PDF page, normalized to the page's dimensions (0..1) so a
// highlight survives zoom and re-layout. Multiple rects cover a multi-line
// selection.
export interface PdfRect {
  x: number; // 0..1 of page width
  y: number; // 0..1 of page height
  width: number; // 0..1 of page width
  height: number; // 0..1 of page height
}

// Where a highlight lives inside a source, in a source-kind-aware form. The
// primary locator; if it fails to resolve, the QuoteSelector rebinds it.
//   epub-cfi: an EPUB Canonical Fragment Identifier.
//   pdf-text: a page number plus normalized rects on that page.
export type HighlightAnchor =
  | { kind: "epub-cfi"; value: string }
  | { kind: "pdf-text"; page: number; rects: PdfRect[] };

export interface QuoteSelector {
  type: "TextQuoteSelector";
  exact: string;
  prefix: string;
  suffix: string;
}

// A Highlight is a stable reference into an immutable Source. It carries two
// selectors, following the W3C Web Annotation model: the `anchor` is the
// primary, kind-specific locator, and `quote` is the cross-format fallback used
// to rebind when the anchor fails to resolve.
export interface Highlight {
  id: string;
  sourceId: string; // sha256 of the source file this highlight lives in
  anchor: HighlightAnchor;
  quote: QuoteSelector;
  createdAt: string; // ISO, display-only
}

export function epubAnchor(value: string): HighlightAnchor {
  return { kind: "epub-cfi", value };
}

export function pdfAnchor(page: number, rects: PdfRect[]): HighlightAnchor {
  return { kind: "pdf-text", page, rects };
}

// A highlight as it may have been persisted before anchors were generalized:
// the EPUB-only shape carried a `cfi` FragmentSelector instead of `anchor`.
interface LegacyCfiSelector {
  value: string;
}
interface LegacyHighlight {
  id: string;
  sourceId: string;
  cfi?: LegacyCfiSelector;
  anchor?: HighlightAnchor;
  quote: QuoteSelector;
  createdAt: string;
}

// Normalize a possibly-legacy highlight (one with `cfi` but no `anchor`) into
// the current shape. Used to migrate persisted NoteAgent state on read.
export function migrateHighlight(h: LegacyHighlight): Highlight {
  const anchor: HighlightAnchor = h.anchor ?? epubAnchor(h.cfi?.value ?? "");
  return { id: h.id, sourceId: h.sourceId, anchor, quote: h.quote, createdAt: h.createdAt };
}

// True if a highlight still carries the legacy `cfi` shape and needs migration.
export function needsHighlightMigration(h: LegacyHighlight): boolean {
  return h.anchor === undefined;
}
