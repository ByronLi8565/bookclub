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
  sourceId: string; // the hash of the book this note belongs to
  author: NoteAuthor;
  parent: string | null; // another note id for replies; null for top-level notes
  body: string; // markdown serialized from Lexical
  highlights: Highlight[];
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  version: number;
}

// A Highlight is a stable reference into an immutable Source.
// It carries two selectors, following the W3C Web Annotation model:
//   CfiSelector:   the primary locator (EPUB CFI).
//   QuoteSelector: the fallback, used to rebind if a CFI fails to resolve.
export interface CfiSelector {
  type: "FragmentSelector";
  conformsTo: "http://www.idpf.org/epub/linking/cfi/epub-cfi.html";
  value: string; // Epubcfi(...)
}

export interface QuoteSelector {
  type: "TextQuoteSelector";
  exact: string;
  prefix: string;
  suffix: string;
}

export interface Highlight {
  id: string;
  sourceId: string; // Sha256 of the SourceFile this Highlight lives in
  cfi: CfiSelector;
  quote: QuoteSelector;
  createdAt: string; // ISO, display-only
}

export function cfiSelector(value: string): CfiSelector {
  return {
    type: "FragmentSelector",
    conformsTo: "http://www.idpf.org/epub/linking/cfi/epub-cfi.html",
    value,
  };
}
