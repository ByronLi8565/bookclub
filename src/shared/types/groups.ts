// Shared group types used by both the client API layer and the server agents.

import type { SourceKind } from "./sources.ts";

export type GroupRole = "owner" | "member";

// Per-source metadata recorded when a source is bound. Legacy groups predate
// this map; the current-source accessors default missing entries to EPUB.
export interface SourceMeta {
  kind: SourceKind;
  contentType: string;
  size: number;
}

export interface GroupSummary {
  groupId: string;
  name: string;
  displayName: string;
  ownerId: string;
  sources: string[];
  bookTitles: Record<string, string>;
  sourceMeta: Record<string, SourceMeta>;
  memberCount: number;
}

export interface Membership {
  isMember: boolean;
  role: GroupRole | null;
}

export interface RosterEntry {
  id: string;
  name: string;
  email: string;
  role: GroupRole;
}
