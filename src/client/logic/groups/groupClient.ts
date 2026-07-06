import * as Schema from "effect/Schema";
import type {
  GroupRole,
  GroupSummary,
  Membership,
  RosterEntry,
} from "../../../shared/types/groups.ts";
import type { SourceHealth } from "../../../shared/types/sourceHealth.ts";
import { EPUB_CONTENT_TYPE, extensionFor, sourceKindFor } from "../../../shared/types/sources.ts";
import { parseHttpError } from "../../http.ts";

export type {
  GroupRole,
  GroupSummary,
  Membership,
  RosterEntry,
} from "../../../shared/types/groups.ts";

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
  author: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const GroupSummary = Schema.Struct({
  groupId: Schema.String,
  slug: Schema.String,
  publicId: Schema.String,
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

const GroupsEnvelope = Schema.Struct({ groups: Schema.Array(Schema.Unknown) });

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

export async function listMyGroups(): Promise<ApiResult<GroupSummary[]>> {
  const r = await fetch("/groups");
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  const envelope = await parseJson(r, GroupsEnvelope);
  if (!envelope) return { ok: false, error: "bad_response" };
  const decode = Schema.decodeUnknownSync(GroupSummary);
  const groups: GroupSummary[] = [];
  for (const raw of envelope.groups) {
    try {
      groups.push(decode(raw));
    } catch {}
  }
  return { ok: true, value: groups };
}

export async function createGroup(displayName: string): Promise<ApiResult<GroupSummary>> {
  const r = await fetch("/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  if (!r.ok) {
    const body = await parseJson(r, ErrorBody);
    return { ok: false, error: body?.reason ?? body?.error ?? `http_${r.status}` };
  }
  const body = await parseJson(r, GroupResponse);
  return body ? { ok: true, value: body.group } : { ok: false, error: "bad_response" };
}

export interface FetchedGroup {
  group: GroupSummary;
  membership: Membership;
  members: RosterEntry[];
}

// Distinguishes a genuine 404 ("no such club") from a network/server failure
// ("can't reach the server") so the UI can fall back to a cached view and an
// offline message instead of wrongly claiming the club doesn't exist.
export type FetchGroupOutcome =
  | ({ status: "ok" } & FetchedGroup)
  | { status: "notfound" }
  | { status: "error" };

export async function fetchGroup(groupRef: string): Promise<FetchGroupOutcome> {
  let r: Response;
  try {
    r = await fetch(`/groups/${groupRef}`);
  } catch {
    return { status: "error" };
  }
  if (r.status === 404) return { status: "notfound" };
  if (!r.ok) return { status: "error" };
  const body = await parseJson(r, FetchGroupResponse);
  return body ? { status: "ok", ...body } : { status: "error" };
}

export async function redeemInvite(
  groupRef: string,
  token: string,
): Promise<ApiResult<GroupSummary>> {
  const r = await fetch(`/groups/${groupRef}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  const body = await parseJson(r, GroupResponse);
  return body ? { ok: true, value: body.group } : { ok: false, error: "bad_response" };
}

export async function inviteToGroup(groupRef: string, email: string): Promise<ApiResult<null>> {
  const r = await fetch(`/groups/${groupRef}/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return r.ok ? { ok: true, value: null } : { ok: false, error: await parseHttpError(r) };
}

export async function getInviteLink(
  groupRef: string,
  rotate = false,
): Promise<ApiResult<{ token: string; link: string }>> {
  const r = await fetch(`/groups/${groupRef}/invite-link${rotate ? "?rotate=1" : ""}`, {
    method: "POST",
  });
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  const body = await parseJson(r, InviteLinkResponse);
  return body ? { ok: true, value: body } : { ok: false, error: "bad_response" };
}

export async function renameGroup(
  groupRef: string,
  title: string,
): Promise<ApiResult<GroupSummary>> {
  const r = await fetch(`/groups/${groupRef}/title`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  const body = await parseJson(r, GroupResponse);
  return body ? { ok: true, value: body.group } : { ok: false, error: "bad_response" };
}

export async function renameBook(
  groupRef: string,
  sourceId: string,
  title: string,
): Promise<ApiResult<GroupSummary>> {
  const r = await fetch(`/groups/${groupRef}/book/title`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId, title }),
  });
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  const body = await parseJson(r, GroupResponse);
  return body ? { ok: true, value: body.group } : { ok: false, error: "bad_response" };
}

export async function resolveBookTitle(
  groupRef: string,
  sourceId: string,
  title: string,
): Promise<ApiResult<GroupSummary>> {
  const r = await fetch(`/groups/${groupRef}/book/parsed-title`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId, title }),
  });
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  const body = await parseJson(r, GroupResponse);
  return body ? { ok: true, value: body.group } : { ok: false, error: "bad_response" };
}

export async function uploadSource(
  groupRef: string,
  file: File,
  health: SourceHealth,
  title: string | null,
  author: string | null,
): Promise<ApiResult<string>> {
  const headers: Record<string, string> = {
    "Content-Type": file.type || EPUB_CONTENT_TYPE,
    "X-Source-Health": encodeURIComponent(JSON.stringify(health)),
  };
  if (title) headers["X-Source-Title"] = encodeURIComponent(title);
  if (author) headers["X-Source-Author"] = encodeURIComponent(author);
  const r = await fetch(`/groups/${groupRef}/book`, { method: "PUT", headers, body: file });
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  const body = await parseJson(r, UploadBookResponse);
  return body ? { ok: true, value: body.hash } : { ok: false, error: "bad_response" };
}

export async function fetchSource(
  groupRef: string,
  requestId?: string,
): Promise<FetchedSource | null> {
  const query = requestId ? `?sourceId=${encodeURIComponent(requestId)}` : "";
  const r = await fetch(`/groups/${groupRef}/book${query}`);
  if (!r.ok) return null;
  const sourceId = r.headers.get("X-Source-Id");
  const contentType = r.headers.get("Content-Type") ?? EPUB_CONTENT_TYPE;
  const kind = sourceKindFor(contentType) ?? "epub";
  const blob = await r.blob();
  return {
    sourceId,
    contentType,
    file: new File([blob], `${sourceId ?? groupRef}.${extensionFor(kind)}`, { type: contentType }),
  };
}
