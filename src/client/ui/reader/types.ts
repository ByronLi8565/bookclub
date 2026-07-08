import type { SourceReadingPosition } from "../../../shared/types/readingPositions.ts";
import type { HighlightAnchor, SourceReader } from "../../logic/notes/highlights.ts";
import type { RenderSnapshot } from "./engine/renderSnapshot.ts";
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
  /** Zoom the current page so its text block fills the viewport. PDF-only. */
  fitToText?: () => void;
  next: () => void;
  prev: () => void;
  goTo: (anchor: HighlightAnchor) => Promise<void>;
  flashHighlight: (anchor: HighlightAnchor) => void;
  drawHighlight: (id: string, anchor: HighlightAnchor, onClick: () => void) => void;
  eraseHighlight: (id: string) => void;
  selection: { x: number; y: number } | null;
  commitSelection: (intent?: SelectIntent) => void;
  dismissSelection: () => void;
  location: SourceLocation | null;
  position: SourceReadingPosition | null;
  snapshot: RenderSnapshot | null;
  reader: SourceReader;
  search: ReaderSearch;
}
// Whether a committed selection becomes a note to compose or a highlight to
// post immediately.
export type SelectIntent = "note" | "highlight";
export type OnSelect = (anchor: HighlightAnchor, range: Range, intent: SelectIntent) => void;
