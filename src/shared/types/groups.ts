import type { SourceKind } from "./sources.ts";

export type GroupRole = "owner" | "member";

export interface SourceMeta {
  kind: SourceKind;
  contentType: string;
  size: number;
  title?: string | null;
  author?: string | null;
}

export interface GroupSummary {
  groupId: string;
  slug: string;
  publicId: string;
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
