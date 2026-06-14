import { BOLD_STAR, ITALIC_STAR, QUOTE, type Transformer } from "@lexical/markdown";
import type { Highlight } from "./highlights.ts";

// A Note is the single self-contained unit of annotation. It absorbs the
// standalone Step 1 Highlight entity: an empty-body note is a plain highlight,
// a note with a body is an annotation, and a note with a parent is a reply.
//
// Notes are authored by the NoteAgent durable object (see src/server): the
// server stamps id, sourceId, createdAt, and version; clients only send the
// content of a change.
export interface Note {
  id: string; // server ULID (sortable, monotonic per book)
  sourceId: string; // the Source (book) hash this note belongs to
  author: string; // "local" until Step 7
  parent: string | null; // another note id for replies; null for top-level notes
  body: string; // markdown serialized from Lexical (may be empty)
  highlights: Highlight[]; // embedded anchors; empty for replies
  createdAt: string; // server clock; display + ordering fallback
  editedAt: string | null;
  deletedAt: string | null;
  version: number; // bumped on edit; groundwork for baseVersion conflicts
}

// The single source of truth for the note body dialect. Both the Lexical editor
// (serialize/parse) and the hand-rolled renderer key off this restricted set:
// paragraphs (implicit), **bold**, *italic*, and `> ` blockquotes. No headings,
// lists, links, images, code, or referenceChips (chips arrive in Step 3).
//
// Order matters for `$convertToMarkdownString`: element transformers first,
// then text-format transformers.
export const NOTE_TRANSFORMERS: Transformer[] = [QUOTE, BOLD_STAR, ITALIC_STAR];

// Minimal, dependency-free markdown -> HTML for read-only note bodies. It must
// mirror exactly the dialect produced by NOTE_TRANSFORMERS and nothing more:
// paragraphs, **bold**, *italic*, and `> ` blockquotes.
//
// Kept deliberately structured: text runs through `renderInline`, which is the
// seam where a referenceChip token branch slots in for Step 3 without a rewrite.
export function renderNoteBody(body: string): string {
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
        return `<blockquote>${renderInline(inner)}</blockquote>`;
      }
      return `<p>${renderInline(lines.join(" "))}</p>`;
    })
    .join("");
}

// Inline formatting over already-escaped text. Bold before italic so the
// double-star run is consumed before the single-star one.
function renderInline(text: string): string {
  return escapeHtml(text)
    .replaceAll(/\*\*(.+?)\*\*/gu, "<strong>$1</strong>")
    .replaceAll(/\*(.+?)\*/gu, "<em>$1</em>");
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
