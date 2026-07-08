import { REFERENCE_PATTERN } from "../../../shared/references.ts";
import { isHighlight, type Note } from "../../../shared/types/notes.ts";

export function noteTitle(note: Note): string {
  const verb = note.parent === null ? (isHighlight(note) ? "highlighted" : "posted") : "replied";
  return noteHeading(note.author.name, verb, note.createdAt);
}
export function noteHeading(
  authorName: string,
  verb: "posted" | "replied" | "highlighted",
  createdAt: string,
): string {
  return `${authorName} ${verb} ${formatNoteTimestamp(createdAt)}`;
}

export function blockquote(exact: string): string {
  return `> ${exact.replaceAll(/\s+/gu, " ").trim()}`;
}

export function highlightMark(exact: string): string {
  return `==${exact.replaceAll(/\s+/gu, " ").trim()}==`;
}
function formatNoteTimestamp(createdAt: string): string {
  return new Date(createdAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
export function noteSnippet(note: Note, max = 80): string {
  const body = note.body
    .replaceAll(REFERENCE_PATTERN, (_whole, digits: string) => `#${digits}`)
    .replaceAll(/[*>=]/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim();
  const text = body || (note.highlights[0]?.quote.exact ?? "").replaceAll(/\s+/gu, " ").trim();
  if (!text) return `#${note.seq}`;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
