import { useMemo } from "react";
import { renderNoteBody } from "../../../notes/render.ts";

// Read-only note body. renderNoteBody escapes all text before formatting, so the
// produced HTML is safe to inject. `refs` (seq -> snippet) decides which `[[n]]`
// become clickable chips; a click is delegated off the chip's data-seq.
export function NoteBodyView({
  body,
  refs,
  onReference,
}: {
  body: string;
  refs: Map<number, string>;
  onReference: (seq: number) => void;
}) {
  const html = useMemo(() => renderNoteBody(body, refs), [body, refs]);
  return (
    <div
      className="note-body"
      onClick={(event) => {
        const chip = (event.target as HTMLElement).closest<HTMLElement>(".note-ref[data-seq]");
        if (chip) onReference(Number(chip.dataset.seq));
      }}
      // oxlint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
