import type { Highlight } from "../highlights/types.ts";

// A Note is the single self-contained unit of annotation. It absorbs the
// standalone Step 1 Highlight entity: an empty-body note is a plain highlight,
// a note with a body is an annotation, and a note with a parent is a reply.
export interface Note {
  id: string; // local uuid now; server ULID in Step 4+
  sourceId: string; // the Source (book) hash this note belongs to
  author: string; // "local" until Step 7
  parent: string | null; // another note id for replies; null for top-level notes
  body: string; // markdown serialized from Lexical (may be empty)
  highlights: Highlight[]; // embedded anchors; empty for replies
  createdAt: string; // local clock; ordering only until seq exists
  editedAt: string | null;
  version: number; // bumped on edit; groundwork for Step 4 baseVersion
}
