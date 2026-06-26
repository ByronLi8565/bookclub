import type { HighlightAnchor, SourceReader } from "../../notes/highlights.ts";
import type { SourceReadingPosition } from "../../../shared/types/readingPositions.ts";
import type { RenderSnapshot } from "./renderSnapshot.ts";
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
  commitSelection: () => void;
  dismissSelection: () => void;
  location: SourceLocation | null;
  position: SourceReadingPosition | null;
  snapshot: RenderSnapshot | null;
  reader: SourceReader;
  search: ReaderSearch;
}

export type OnSelect = (anchor: HighlightAnchor, range: Range) => void;

/** Increment a sequence ref, used to invalidate in-flight async render/measure work. */
export function bumpSeq(ref: { current: number }): void {
  ref.current += 1;
}
