import * as Schema from "effect/Schema";
import type {
  GroupRole,
  GroupSummary,
  Membership,
  RosterEntry,
} from "../../shared/types/groups.ts";
import type { SourceHealth } from "../../shared/types/sourceHealth.ts";
import { EPUB_CONTENT_TYPE, extensionFor, sourceKindFor } from "../../shared/types/sources.ts";

export type {
  GroupRole,
  GroupSummary,
  Membership,
  RosterEntry,
} from "../../shared/types/groups.ts";

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface FetchedSource {
  sourceId: string | null;
  contentType: string;
  file: File;
}

const GroupRole = Schema.Union([Schema.Literal("owner"), Schema.Literal("member")]);

const SourceMeta = Schema.Struct({
  kind: Schema.Union([Schema.Literal("epub"), Schema.Literal("pdf")]),
  contentType: Schema.String,
  size: Schema.Number,
  title: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const GroupSummary = Schema.Struct({
  groupId: Schema.String,
  name: Schema.String,
  displayName: Schema.String,
  ownerId: Schema.String,
  sources: Schema.mutable(Schema.Array(Schema.String)),
  bookTitles: Schema.Record(Schema.String, Schema.String),
  sourceMeta: Schema.Record(Schema.String, SourceMeta),
  memberCount: Schema.Number,
});

const Membership = Schema.Struct({ isMember: Schema.Boolean, role: Schema.NullOr(GroupRole) });

const RosterEntry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  role: GroupRole,
});

const ErrorBody = Schema.Struct({
  error: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(Schema.String),
});

const GroupsResponse = Schema.Struct({ groups: Schema.mutable(Schema.Array(GroupSummary)) });

const GroupResponse = Schema.Struct({ group: GroupSummary });

const FetchGroupResponse = Schema.Struct({
  group: GroupSummary,
  membership: Membership,
  members: Schema.mutable(Schema.Array(RosterEntry)),
});

const InviteLinkResponse = Schema.Struct({ token: Schema.String, link: Schema.String });
const UploadBookResponse = Schema.Struct({ hash: Schema.String });

async function parseJson<S extends Schema.Top>(
  response: Response,
  schema: S,
): Promise<Schema.Schema.Type<S> | null> {
  try {
    return Schema.decodeUnknownSync(schema as unknown as Schema.Decoder<unknown, never>)(
      await response.json(),
    ) as Schema.Schema.Type<S>;
  } catch {
    return null;
  }
}

async function readError(response: Response): Promise<string> {
  const body = await parseJson(response, ErrorBody);
  return body?.error ?? `http_${response.status}`;
}

// The groups the signed-in user belongs to (GET /groups).
export async function listMyGroups(): Promise<GroupSummary[]> {
  const r = await fetch("/groups");
  if (!r.ok) return [];
  return (await parseJson(r, GroupsResponse))?.groups ?? [];
}

// Create a group with a write-once URL name (POST /groups).
export async function createGroup(name: string): Promise<ApiResult<GroupSummary>> {
  const r = await fetch("/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) {
    // For an invalid name the worker returns the precise rule in `reason`
    // (bad_charset, too_long, …); prefer it over the generic `error`.
    const body = await parseJson(r, ErrorBody);
    return { ok: false, error: body?.reason ?? body?.error ?? `http_${r.status}` };
  }
  const body = await parseJson(r, GroupResponse);
  return body ? { ok: true, value: body.group } : { ok: false, error: "bad_response" };
}

// Resolve a group by URL name plus the caller's membership (GET /groups/:name).
// Returns null when the name is unclaimed or illegal.
export async function fetchGroup(
  name: string,
): Promise<{ group: GroupSummary; membership: Membership; members: RosterEntry[] } | null> {
  const r = await fetch(`/groups/${name}`);
  if (r.status === 404) return null;
  if (!r.ok) return null;
  return parseJson(r, FetchGroupResponse);
}

// Redeem an invite token to join a group (POST /groups/:name/join).
export async function redeemInvite(name: string, token: string): Promise<ApiResult<GroupSummary>> {
  const r = await fetch(`/groups/${name}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!r.ok) return { ok: false, error: await readError(r) };
  const body = await parseJson(r, GroupResponse);
  return body ? { ok: true, value: body.group } : { ok: false, error: "bad_response" };
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
  const body = await parseJson(r, InviteLinkResponse);
  return body ? { ok: true, value: body } : { ok: false, error: "bad_response" };
}

// Any member: rename the club's display name (PUT /groups/:name/title).
export async function renameGroup(name: string, title: string): Promise<ApiResult<GroupSummary>> {
  const r = await fetch(`/groups/${name}/title`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!r.ok) return { ok: false, error: await readError(r) };
  const body = await parseJson(r, GroupResponse);
  return body ? { ok: true, value: body.group } : { ok: false, error: "bad_response" };
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
  const body = await parseJson(r, GroupResponse);
  return body ? { ok: true, value: body.group } : { ok: false, error: "bad_response" };
}

// Owner-only: upload the group's source — EPUB or PDF (PUT /groups/:name/book).
// The pre-upload health report rides along in a header (Option A): the client
// gates on it; the server validates the file's magic bytes independently.
export async function uploadSource(
  name: string,
  file: File,
  health: SourceHealth,
  title: string | null,
): Promise<ApiResult<string>> {
  const headers: Record<string, string> = {
    "Content-Type": file.type || EPUB_CONTENT_TYPE,
    "X-Source-Health": encodeURIComponent(JSON.stringify(health)),
  };
  if (title) headers["X-Source-Title"] = encodeURIComponent(title);
  const r = await fetch(`/groups/${name}/book`, {
    method: "PUT",
    headers,
    body: file,
  });
  if (!r.ok) return { ok: false, error: await readError(r) };
  const body = await parseJson(r, UploadBookResponse);
  return body ? { ok: true, value: body.hash } : { ok: false, error: "bad_response" };
}

// Fetch a group's source bytes (GET /groups/:name/book). Without a sourceId the
// club's default (first) book is returned; pass one to load a specific book.
// Returns null when no source has been uploaded yet (or access is refused). The
// filename extension reflects the content type so the reader adapter can be
// chosen from the File.
export async function fetchSource(name: string, requestId?: string): Promise<FetchedSource | null> {
  const query = requestId ? `?sourceId=${encodeURIComponent(requestId)}` : "";
  const r = await fetch(`/groups/${name}/book${query}`);
  if (!r.ok) return null;
  const sourceId = r.headers.get("X-Source-Id");
  const contentType = r.headers.get("Content-Type") ?? EPUB_CONTENT_TYPE;
  const kind = sourceKindFor(contentType) ?? "epub";
  const blob = await r.blob();
  return {
    sourceId,
    contentType,
    file: new File([blob], `${sourceId ?? name}.${extensionFor(kind)}`, { type: contentType }),
  };
}
