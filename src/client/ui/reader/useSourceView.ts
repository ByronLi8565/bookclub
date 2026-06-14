import type { SourceRef } from "../../../shared/types/sources.ts";
import { useEpubSourceView } from "./useEpubSourceView.ts";
import { usePdfSourceView } from "./usePdfSourceView.ts";
import type { OnSelect, SourceView } from "./sourceView.ts";

export type { SourceView, SourceLocation, OnSelect } from "./sourceView.ts";

// The source-kind dispatcher. Both adapters are called unconditionally (stable
// hook order); each receives the file only when it owns the current source, so
// the inactive one stays idle. `Workspace` and `Reader` consume the returned
// SourceView without knowing which adapter produced it.
export function useSourceView(
  source: SourceRef | null,
  file: File | null,
  onSelect: OnSelect,
  onSwipe?: (dir: "left" | "right") => void,
): SourceView {
  const isPdf = source?.kind === "pdf";
  const epub = useEpubSourceView(isPdf ? null : file, onSelect, onSwipe);
  const pdf = usePdfSourceView(isPdf ? file : null, onSelect, onSwipe);
  return isPdf ? pdf : epub;
}
