import type { HighlightAnchor, SourceReader } from "../../notes/highlights.ts";
import type { ReaderSearch } from "./useReaderSearch.ts";

// The reader's position within the source, normalized across formats: a page
// within the current unit (an epub spine item, or the pdf document), the unit's
// total, an overall percentage, and whether we're at the very start/end.
export interface SourceLocation {
  page: number;
  total: number;
  percentage: number;
  atStart: boolean;
  atEnd: boolean;
}

// The format-agnostic reader surface. Both the EPUB and PDF adapters implement
// this; `Reader` and `Workspace` consume it without branching on source kind
// (except possibly for copy). Anchors are kind-specific but opaque here.
export interface SourceView {
  containerRef: React.RefObject<HTMLDivElement | null>;
  ready: boolean;
  // The source's parsed metadata title, once loaded (null until then / if absent).
  title: string | null;
  fontSize: number;
  setFontSize: (pct: number) => void;
  next: () => void;
  prev: () => void;
  goTo: (anchor: HighlightAnchor) => void;
  drawHighlight: (id: string, anchor: HighlightAnchor, onClick: () => void) => void;
  eraseHighlight: (id: string) => void;
  // A live text selection awaiting confirmation, anchored at viewport coords.
  selection: { x: number; y: number } | null;
  commitSelection: () => void;
  dismissSelection: () => void;
  location: SourceLocation | null;
  reader: SourceReader;
  // Full-text (ctrl+f) search over the source.
  search: ReaderSearch;
}

// The callback a reader adapter invokes when the reader commits a selection: the
// kind-specific anchor plus the live range (for quote derivation).
export type OnSelect = (anchor: HighlightAnchor, range: Range) => void;
