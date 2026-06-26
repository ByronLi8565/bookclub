import { type Transformer, QUOTE, BOLD_STAR, ITALIC_STAR } from "@lexical/markdown";
import { escapeHtml } from "../../../shared/format.ts";
import { REFERENCE_PATTERN } from "../../../shared/references.ts";

export const NOTE_TRANSFORMERS: Transformer[] = [QUOTE, BOLD_STAR, ITALIC_STAR];
export function renderNoteBody(body: string, refs: Map<number, string> = new Map()): string {
  const blocks = body.split(/\n{2,}/u).flatMap((raw) => {
    const block = raw.trim();
    return block ? [block] : [];
  });

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
