import { useMemo } from "react";
import { renderNoteBody } from "../../../notes/render.ts";

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
