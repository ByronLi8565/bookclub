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
  author: Schema.optionalKey(Schema.NullOr(Schema.String)),
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

async function readError(response: Response): Promise<string> {
  const body = await parseJson(response, ErrorBody);
  return body?.error ?? `http_${response.status}`;
}


export async function listMyGroups(): Promise<GroupSummary[]> {
  const r = await fetch("/groups");
  if (!r.ok) return [];
  const envelope = await parseJson(r, GroupsEnvelope);
  if (!envelope) return [];
  const decode = Schema.decodeUnknownSync(GroupSummary);
  const groups: GroupSummary[] = [];
  for (const raw of envelope.groups) {
    try {
      groups.push(decode(raw));
    } catch {

    }
  }
  return groups;
}

export async function createGroup(name: string): Promise<ApiResult<GroupSummary>> {
  const r = await fetch("/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) {


    const body = await parseJson(r, ErrorBody);
    return { ok: false, error: body?.reason ?? body?.error ?? `http_${r.status}` };
  }
  const body = await parseJson(r, GroupResponse);
  return body ? { ok: true, value: body.group } : { ok: false, error: "bad_response" };
}


export async function fetchGroup(
  name: string,
): Promise<{ group: GroupSummary; membership: Membership; members: RosterEntry[] } | null> {
  const r = await fetch(`/groups/${name}`);
  if (r.status === 404) return null;
  if (!r.ok) return null;
  return parseJson(r, FetchGroupResponse);
}

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

export async function inviteToGroup(name: string, email: string): Promise<ApiResult<null>> {
  const r = await fetch(`/groups/${name}/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return r.ok ? { ok: true, value: null } : { ok: false, error: await readError(r) };
}

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



export async function resolveBookTitle(
  name: string,
  sourceId: string,
  title: string,
): Promise<ApiResult<GroupSummary>> {
  const r = await fetch(`/groups/${name}/book/parsed-title`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId, title }),
  });
  if (!r.ok) return { ok: false, error: await readError(r) };
  const body = await parseJson(r, GroupResponse);
  return body ? { ok: true, value: body.group } : { ok: false, error: "bad_response" };
}



export async function uploadSource(
  name: string,
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
  const r = await fetch(`/groups/${name}/book`, { method: "PUT", headers, body: file });
  if (!r.ok) return { ok: false, error: await readError(r) };
  const body = await parseJson(r, UploadBookResponse);
  return body ? { ok: true, value: body.hash } : { ok: false, error: "bad_response" };
}





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
