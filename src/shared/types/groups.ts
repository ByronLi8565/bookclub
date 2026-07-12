import type { SourceKind } from "./sources.ts";

export const GroupRole = {
  Owner: "owner",
  Admin: "admin",
  Member: "member",
  Visitor: "visitor",
} as const;

export type GroupRole = (typeof GroupRole)[keyof typeof GroupRole];

export function isGroupRole(value: unknown): value is GroupRole {
  return typeof value === "string" && Object.values(GroupRole).includes(value as GroupRole);
}

export const GroupFailureReason = {
  Exists: "exists",
  NotMember: "not_member",
  NotFound: "not_found",
  Forbidden: "forbidden",
  BadSource: "bad_source",
  Empty: "empty",
  BadInvite: "bad_invite",
  WrongEmail: "wrong_email",
  BadMember: "bad_member",
} as const;

export type GroupFailureReason = (typeof GroupFailureReason)[keyof typeof GroupFailureReason];

export interface SourceMeta {
  kind: SourceKind;
  contentType: string;
  size: number;
  title?: string | null;
  author?: string | null;
  wordCount?: number | null;
  addedBy: string;
}

export interface BookMetadataPatch {
  author?: string | null;
  wordCount?: number | null;
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
  avatarImageId?: string;
}
