import { EPUB_CONTENT_TYPE } from "../../server/books.ts";

// The client-side view of a group, mirroring the server's GroupSummary.
export interface GroupSummary {
  groupId: string;
  name: string;
  displayName: string;
  ownerId: string;
  sources: string[];
  bookTitles: Record<string, string>;
  memberCount: number;
}

export type GroupRole = "owner" | "member";

export interface Membership {
  isMember: boolean;
  role: GroupRole | null;
}

export interface RosterEntry {
  id: string;
  name: string;
  role: GroupRole;
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `http_${response.status}`;
  } catch {
    return `http_${response.status}`;
  }
}

// The groups the signed-in user belongs to (GET /groups).
export async function listMyGroups(): Promise<GroupSummary[]> {
  const r = await fetch("/groups");
  if (!r.ok) return [];
  return ((await r.json()) as { groups: GroupSummary[] }).groups;
}

// Create a group with a write-once URL name (POST /groups).
export async function createGroup(name: string): Promise<ApiResult<GroupSummary>> {
  const r = await fetch("/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) return { ok: false, error: await readError(r) };
  return { ok: true, value: ((await r.json()) as { group: GroupSummary }).group };
}

// Resolve a group by URL name plus the caller's membership (GET /groups/:name).
// Returns null when the name is unclaimed or illegal.
export async function fetchGroup(
  name: string,
): Promise<{ group: GroupSummary; membership: Membership; members: RosterEntry[] } | null> {
  const r = await fetch(`/groups/${name}`);
  if (r.status === 404) return null;
  if (!r.ok) return null;
  return (await r.json()) as {
    group: GroupSummary;
    membership: Membership;
    members: RosterEntry[];
  };
}

// Redeem an invite token to join a group (POST /groups/:name/join).
export async function redeemInvite(name: string, token: string): Promise<ApiResult<GroupSummary>> {
  const r = await fetch(`/groups/${name}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!r.ok) return { ok: false, error: await readError(r) };
  return { ok: true, value: ((await r.json()) as { group: GroupSummary }).group };
}

// Owner-only: invite an email to the group (POST /groups/:name/invite).
export async function inviteToGroup(name: string, email: string): Promise<ApiResult<null>> {
  const r = await fetch(`/groups/${name}/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return r.ok ? { ok: true, value: null } : { ok: false, error: await readError(r) };
}

// Owner-only: get or rotate the group's open invite link (POST .../invite-link).
export async function getInviteLink(
  name: string,
  rotate = false,
): Promise<ApiResult<{ token: string; link: string }>> {
  const r = await fetch(`/groups/${name}/invite-link${rotate ? "?rotate=1" : ""}`, {
    method: "POST",
  });
  if (!r.ok) return { ok: false, error: await readError(r) };
  return { ok: true, value: (await r.json()) as { token: string; link: string } };
}

// Any member: rename the club's display name (PUT /groups/:name/title).
export async function renameGroup(name: string, title: string): Promise<ApiResult<GroupSummary>> {
  const r = await fetch(`/groups/${name}/title`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!r.ok) return { ok: false, error: await readError(r) };
  return { ok: true, value: ((await r.json()) as { group: GroupSummary }).group };
}

// Any member: set a display title for a bound book (PUT .../book/title).
export async function renameBook(
  name: string,
  sourceId: string,
  title: string,
): Promise<ApiResult<GroupSummary>> {
  const r = await fetch(`/groups/${name}/book/title`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId, title }),
  });
  if (!r.ok) return { ok: false, error: await readError(r) };
  return { ok: true, value: ((await r.json()) as { group: GroupSummary }).group };
}

// Owner-only: upload the group's book (PUT /groups/:name/book).
export async function uploadBook(name: string, file: File): Promise<ApiResult<string>> {
  const r = await fetch(`/groups/${name}/book`, {
    method: "PUT",
    headers: { "Content-Type": EPUB_CONTENT_TYPE },
    body: file,
  });
  if (!r.ok) return { ok: false, error: await readError(r) };
  return { ok: true, value: ((await r.json()) as { hash: string }).hash };
}

// Fetch the group's book bytes as a File (GET /groups/:name/book). Returns null
// when no book has been uploaded yet (or access is refused).
export async function fetchBook(name: string): Promise<File | null> {
  const r = await fetch(`/groups/${name}/book`);
  if (!r.ok) return null;
  const blob = await r.blob();
  return new File([blob], `${name}.epub`, { type: EPUB_CONTENT_TYPE });
}
