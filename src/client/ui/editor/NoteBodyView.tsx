import { useMemo } from "react";
import { renderNoteBody } from "../../notes/renderNoteBody.ts";

// Read-only note body. renderNoteBody escapes all text before formatting, so
// the produced HTML is safe to inject.
export function NoteBodyView({ body }: { body: string }) {
  const html = useMemo(() => renderNoteBody(body), [body]);
  // oxlint-disable-next-line react/no-danger
  return <div className="note-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
