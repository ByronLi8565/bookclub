import type { SourceRef } from "../../../shared/types/sources.ts";
import { useEpubSourceView } from "./useEpubSourceView.ts";
import { usePdfSourceView } from "./usePdfSourceView.ts";
import type { OnSelect, SourceView } from "./sourceView.ts";

export type { SourceView, SourceLocation, OnSelect } from "./sourceView.ts";

export function useSourceView(
  source: SourceRef | null,
  file: File | null,
  onSelect: OnSelect,
  onSwipe?: (dir: "left" | "right") => void,
  onSearchHighlightCleared?: () => void,
): SourceView {
  const isPdf = source?.kind === "pdf";
  const epub = useEpubSourceView(isPdf ? null : file, onSelect, onSwipe, onSearchHighlightCleared);
  const pdf = usePdfSourceView(isPdf ? file : null, onSelect, onSwipe, onSearchHighlightCleared);
  return isPdf ? pdf : epub;
}
