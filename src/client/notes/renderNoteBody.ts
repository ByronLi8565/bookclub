// Minimal, dependency-free markdown -> HTML for read-only note bodies. It must
// mirror exactly the dialect produced by NOTE_TRANSFORMERS and nothing more:
// paragraphs, **bold**, *italic*, and `> ` blockquotes.
//
// Kept deliberately structured: text runs through `renderInline`, which is the
// seam where a referenceChip token branch slots in for Step 3 without a rewrite.

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// Inline formatting over already-escaped text. Bold before italic so the
// double-star run is consumed before the single-star one.
function renderInline(text: string): string {
  return escapeHtml(text)
    .replaceAll(/\*\*(.+?)\*\*/gu, "<strong>$1</strong>")
    .replaceAll(/\*(.+?)\*/gu, "<em>$1</em>");
}

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
