import { BOLD_STAR, ITALIC_STAR, QUOTE, type Transformer } from "@lexical/markdown";
import type { Highlight } from "./highlights.ts";
import { REFERENCE_PATTERN } from "./references.ts";

export interface Note {
  id: string; // server ULID (sortable, monotonic per book)
  seq: number; // human-readable per-book number; the
  sourceId: string; // the hash of the book this note belongs to
  author: string;
  parent: string | null; // another note id for replies; null for top-level notes
  body: string; // markdown serialized from Lexical
  highlights: Highlight[];
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  version: number;
}

// A note's anchor in the book: its own first highlight or that of the nearest ancestor

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

// The note body dialect.
// Order matters for `$convertToMarkdownString`: element transformers first,
// then text-format transformers.
export const NOTE_TRANSFORMERS: Transformer[] = [QUOTE, BOLD_STAR, ITALIC_STAR];

// A one-line preview of a note, used as the hover hint on a `[[n]]` chip. Prefers
// body text (markdown stripped, references shown as #n); falls back to the
// anchored quote, then the bare number for an empty highlight-only note.
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

// Markdown to HTML for read-only note bodies.
// Paragraphs, **bold**, *italic*, `> ` blockquotes, and `[[n]]` references.
export function renderNoteBody(body: string, refs: Map<number, string> = new Map()): string {
  // Blank-line-separated runs become blocks; a run of `> ` lines is a quote.
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

// Inline formatting over already-escaped text. References resolve first so a
// seq's snippet is not overridden by emphasis rules; bold runs before italic so the
// double-star run is consumed before the single-star one. An unresolved `[[n]]`
// is left as plain text rather than rendered as a (broken) chip.
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

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
