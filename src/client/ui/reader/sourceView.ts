import type { HighlightAnchor, SourceReader } from "../../notes/highlights.ts";
import type { ReaderSearch } from "./useReaderSearch.ts";

export interface SourceLocation {
  page: number;
  total: number;
  percentage: number;
  atStart: boolean;
  atEnd: boolean;
}

export interface SourceView {
  containerRef: React.RefObject<HTMLDivElement | null>;
  ready: boolean;
  title: string | null;
  fontSize: number;
  setFontSize: (pct: number) => void;
  next: () => void;
  prev: () => void;
  goTo: (anchor: HighlightAnchor) => void;
  drawHighlight: (id: string, anchor: HighlightAnchor, onClick: () => void) => void;
  eraseHighlight: (id: string) => void;
  selection: { x: number; y: number } | null;
  commitSelection: () => void;
  dismissSelection: () => void;
  location: SourceLocation | null;
  reader: SourceReader;
  search: ReaderSearch;
}

export type OnSelect = (anchor: HighlightAnchor, range: Range) => void;
