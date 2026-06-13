import type { Highlight } from "../highlights/types.ts";

// A Card is the single self-contained unit of annotation. It absorbs the
// standalone Step 1 Highlight entity: an empty-body card is a plain highlight,
// a card with a body is a note, and a card with a parent is a reply.
export interface Card {
  id: string; // local uuid now; server ULID in Step 4+
  sourceId: string; // the Source (book) hash this card belongs to
  author: string; // "local" until Step 7
  parent: string | null; // another card id for replies; null for top-level notes
  body: string; // markdown serialized from Lexical (may be empty)
  highlights: Highlight[]; // embedded anchors; empty for replies
  createdAt: string; // local clock; ordering only until seq exists
  editedAt: string | null;
  version: number; // bumped on edit; groundwork for Step 4 baseVersion
}
