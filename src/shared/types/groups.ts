// Shared group types used by both the client API layer and the server agents.

export type GroupRole = "owner" | "member";

export interface GroupSummary {
  groupId: string;
  name: string;
  displayName: string;
  ownerId: string;
  sources: string[];
  bookTitles: Record<string, string>;
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
