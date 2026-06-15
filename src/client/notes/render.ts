import { BOLD_STAR, ITALIC_STAR, QUOTE, type Transformer } from "@lexical/markdown";
import type { Highlight, Note } from "../../shared/types/notes.ts";
import { REFERENCE_PATTERN } from "../../shared/references.ts";
import { escapeHtml } from "../../shared/util.ts";

export type { Note, NoteAuthor } from "../../shared/types/notes.ts";


export function effectiveHighlight(note: Note, byId: Map<string, Note>): Highlight | null {
  const seen = new Set<string>();
  let current: Note | undefined = note;
  while (current && !seen.has(current.id)) {
    if (current.highlights[0]) return current.highlights[0];
    seen.add(current.id);
    current = current.parent === null ? undefined : byId.get(current.parent);
  }
  return null;
}



export const NOTE_TRANSFORMERS: Transformer[] = [QUOTE, BOLD_STAR, ITALIC_STAR];



export function noteSnippet(note: Note, max = 80): string {
  const body = note.body
    .replaceAll(REFERENCE_PATTERN, (_whole, digits: string) => `#${digits}`)
    .replaceAll(/[*>]/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim();
  const text = body || (note.highlights[0]?.quote.exact ?? "").replaceAll(/\s+/gu, " ").trim();
  if (!text) return `#${note.seq}`;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}


export function renderNoteBody(body: string, refs: Map<number, string> = new Map()): string {

  const blocks = body
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((line) => line.startsWith(">"))) {
        const inner = lines.map((line) => line.replace(/^>\s?/u, "")).join(" ");
        return `<blockquote>${renderInline(inner, refs)}</blockquote>`;
      }
      return `<p>${renderInline(lines.join(" "), refs)}</p>`;
    })
    .join("");
}




function renderInline(text: string, refs: Map<number, string>): string {
  const withRefs = escapeHtml(text).replaceAll(REFERENCE_PATTERN, (whole, digits: string) => {
    const seq = Number(digits);
    const snippet = refs.get(seq);
    if (snippet === undefined) return whole;
    return `<button type="button" class="note-ref" data-seq="${seq}" title="${escapeHtml(snippet)}">${seq}</button>`;
  });
  return withRefs
    .replaceAll(/\*\*(.+?)\*\*/gu, "<strong>$1</strong>")
    .replaceAll(/\*(.+?)\*/gu, "<em>$1</em>");
}
