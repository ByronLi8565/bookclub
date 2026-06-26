import type { SourceRef } from "../../../shared/types/sources.ts";
import type { SourceReadingPosition } from "../../../shared/types/readingPositions.ts";
import { useEpubSourceView } from "./useEpubSourceView.ts";
import { usePdfSourceView } from "./usePdfSourceView.ts";
import type { OnSelect } from "./types.ts";
import type { SourceView } from "./types.ts";

export type { SourceView, SourceLocation, OnSelect } from "./types.ts";

export function useSourceView(
  source: SourceRef | null,
  file: File | null,
  onSelect: OnSelect,
  onSwipe?: (dir: "left" | "right" | "up" | "down") => void,
  onSearchHighlightCleared?: () => void,
  initialPosition?: SourceReadingPosition | null,
): SourceView {
  const isPdf = source?.kind === "pdf";
  const epub = useEpubSourceView(
    isPdf ? null : file,
    onSelect,
    onSwipe,
    onSearchHighlightCleared,
    initialPosition?.kind === "epub" ? initialPosition : null,
  );
  // PDF pane-switching is handled solely by MobilePager's swiper; the PDF view
  // intentionally takes no onSwipe so sideways drags pan the page instead.
  const pdf = usePdfSourceView(
    isPdf ? (source?.id ?? null) : null,
    isPdf ? file : null,
    onSelect,
    onSearchHighlightCleared,
    initialPosition?.kind === "pdf" ? initialPosition : null,
  );
  return isPdf ? pdf : epub;
}
