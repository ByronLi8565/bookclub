import * as Schema from "effect/Schema";
import { apiFetch } from "../net/api.ts";
import {
  GroupSummary,
  Membership,
  RosterEntry,
  type BookMetadataPatch,
  type GroupRole,
} from "../../../shared/types/groups.ts";
import { EPUB_CONTENT_TYPE, extensionFor, sourceKindFor } from "../../../shared/types/sources.ts";
import { parseHttpError } from "../../http.ts";
import { decode } from "../../../shared/schema.ts";
import { ClubProfile } from "../../../shared/types/profiles.ts";

export type {
  BookMetadataPatch,
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

const ClubProfileResponse = Schema.Struct({ profile: ClubProfile });

const ErrorBody = Schema.Struct({
  error: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(Schema.String),
});

const GroupsEnvelope = Schema.Struct({ groups: Schema.mutable(Schema.Array(GroupSummary)) });

const GroupResponse = Schema.Struct({ group: GroupSummary });

const FetchGroupResponse = Schema.Struct({
  group: GroupSummary,
  membership: Membership,
  members: Schema.mutable(Schema.Array(RosterEntry)),
});

const InviteLinkResponse = Schema.Struct({ token: Schema.String, link: Schema.String });
const MembersResponse = Schema.Struct({ members: Schema.mutable(Schema.Array(RosterEntry)) });
const UploadBookResponse = Schema.Struct({ hash: Schema.String });
const UploadImageResponse = Schema.Struct({
  id: Schema.String,
  contentType: Schema.String,
  size: Schema.Number,
});
const GroupImage = Schema.Struct({
  id: Schema.String,
  size: Schema.Number,
  contentType: Schema.String,
  uploadedAt: Schema.String,
  uploadedBy: Schema.NullOr(Schema.String),
  uploaderName: Schema.String,
});
const GroupImagesResponse = Schema.Struct({
  images: Schema.mutable(Schema.Array(GroupImage)),
  totalSize: Schema.Number,
});
const RestoreBackupResponse = Schema.Struct({
  notes: Schema.Number,
  images: Schema.Number,
  createdAt: Schema.String,
});

export type GroupImage = Schema.Schema.Type<typeof GroupImage>;

const MAX_IMAGE_UPLOAD_BYTES = 2 * 1024 * 1024;

type ImageUploadKind = "note" | "avatar";

const IMAGE_UPLOAD_PRESETS: Record<ImageUploadKind, { edges: number[]; qualities: number[] }> = {
  note: { edges: [1600, 1400, 1200, 960], qualities: [0.78, 0.68, 0.58] },
  avatar: { edges: [768, 512, 384], qualities: [0.78, 0.68, 0.58] },
};

async function compressedImage(file: File, kind: ImageUploadKind): Promise<ApiResult<File>> {
  if (!file.type.startsWith("image/")) return { ok: false, error: "unsupported_type" };
  if (file.type === "image/gif") {
    return file.size <= MAX_IMAGE_UPLOAD_BYTES
      ? { ok: true, value: file }
      : { ok: false, error: "too_large" };
  }
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, error: "image_processing_failed" };
    let smallest: File | null = file.size <= MAX_IMAGE_UPLOAD_BYTES ? file : null;
    const preset = IMAGE_UPLOAD_PRESETS[kind];
    for (const edge of preset.edges) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(bitmap, 0, 0, width, height);
      for (const quality of preset.qualities) {
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, "image/webp", quality);
        });
        if (!blob) continue;
        const compressed = new File([blob], file.name.replace(/\.[^.]*$/u, ".webp"), {
          type: blob.type,
        });
        if (!smallest || compressed.size < smallest.size) smallest = compressed;
        if (compressed.size <= MAX_IMAGE_UPLOAD_BYTES) return { ok: true, value: compressed };
      }
    }
    return smallest && smallest.size <= MAX_IMAGE_UPLOAD_BYTES
      ? { ok: true, value: smallest }
      : { ok: false, error: "too_large" };
  } finally {
    bitmap.close();
  }
}

async function parseJson<S extends Schema.Decoder<unknown>>(
  response: Response,
  schema: S,
): Promise<S["Type"] | null> {
  try {
    return decode(schema, await response.json());
  } catch {
    return null;
  }
}

export async function listMyGroups(): Promise<ApiResult<GroupSummary[]>> {
  const r = await apiFetch("/groups");
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  const envelope = await parseJson(r, GroupsEnvelope);
  if (!envelope) return { ok: false, error: "bad_response" };
  return { ok: true, value: envelope.groups };
}

export async function createGroup(displayName: string): Promise<ApiResult<GroupSummary>> {
  const r = await apiFetch("/groups", {
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
    r = await apiFetch(`/groups/${groupRef}`);
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
  const r = await apiFetch(`/groups/${groupRef}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  const body = await parseJson(r, GroupResponse);
  return body ? { ok: true, value: body.group } : { ok: false, error: "bad_response" };
}

export async function inviteToGroup(groupRef: string, email: string): Promise<ApiResult<null>> {
  const r = await apiFetch(`/groups/${groupRef}/invite`, {
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
  const r = await apiFetch(`/groups/${groupRef}/invite-link${rotate ? "?rotate=1" : ""}`, {
    method: "POST",
  });
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  const body = await parseJson(r, InviteLinkResponse);
  return body ? { ok: true, value: body } : { ok: false, error: "bad_response" };
}

export async function changeMemberRole(
  groupRef: string,
  memberId: string,
  role: GroupRole,
): Promise<ApiResult<RosterEntry[]>> {
  const r = await apiFetch(`/groups/${groupRef}/members/${encodeURIComponent(memberId)}/role`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  const body = await parseJson(r, MembersResponse);
  return body ? { ok: true, value: body.members } : { ok: false, error: "bad_response" };
}

export async function renameGroup(
  groupRef: string,
  title: string,
): Promise<ApiResult<GroupSummary>> {
  const r = await apiFetch(`/groups/${groupRef}/title`, {
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
  const r = await apiFetch(`/groups/${groupRef}/book/title`, {
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
  const r = await apiFetch(`/groups/${groupRef}/book/parsed-title`, {
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
  title: string | null,
  author: string | null,
  wordCount: number | null,
): Promise<ApiResult<string>> {
  const headers: Record<string, string> = { "Content-Type": file.type || EPUB_CONTENT_TYPE };
  if (title) headers["X-Source-Title"] = encodeURIComponent(title);
  if (author) headers["X-Source-Author"] = encodeURIComponent(author);
  if (wordCount !== null) headers["X-Source-Word-Count"] = String(wordCount);
  const r = await apiFetch(`/groups/${groupRef}/book`, { method: "PUT", headers, body: file });
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  const body = await parseJson(r, UploadBookResponse);
  return body ? { ok: true, value: body.hash } : { ok: false, error: "bad_response" };
}

export async function deleteBook(
  groupRef: string,
  sourceId: string,
): Promise<ApiResult<GroupSummary>> {
  const r = await apiFetch(`/groups/${groupRef}/book/${encodeURIComponent(sourceId)}`, {
    method: "DELETE",
  });
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  const body = await parseJson(r, GroupResponse);
  return body ? { ok: true, value: body.group } : { ok: false, error: "bad_response" };
}

export async function updateBookMetadata(
  groupRef: string,
  sourceId: string,
  patch: BookMetadataPatch,
): Promise<ApiResult<GroupSummary>> {
  const r = await apiFetch(`/groups/${groupRef}/book/${encodeURIComponent(sourceId)}/metadata`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  const body = await parseJson(r, GroupResponse);
  return body ? { ok: true, value: body.group } : { ok: false, error: "bad_response" };
}

export async function uploadNoteImage(groupRef: string, file: File): Promise<ApiResult<string>> {
  const compressed = await compressedImage(file, "note");
  if (!compressed.ok) return compressed;
  const image = compressed.value;
  const r = await apiFetch(`/groups/${groupRef}/images`, {
    method: "POST",
    headers: { "Content-Type": image.type || "application/octet-stream" },
    body: image,
  });
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  const body = await parseJson(r, UploadImageResponse);
  return body ? { ok: true, value: body.id } : { ok: false, error: "bad_response" };
}

export async function deleteNoteImage(groupRef: string, imageId: string): Promise<ApiResult<null>> {
  const r = await apiFetch(`/groups/${groupRef}/images/${encodeURIComponent(imageId)}`, {
    method: "DELETE",
  });
  return r.ok ? { ok: true, value: null } : { ok: false, error: await parseHttpError(r) };
}

export async function listGroupImages(
  groupRef: string,
): Promise<ApiResult<{ images: GroupImage[]; totalSize: number }>> {
  const r = await apiFetch(`/groups/${groupRef}/images`);
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  const body = await parseJson(r, GroupImagesResponse);
  return body ? { ok: true, value: body } : { ok: false, error: "bad_response" };
}

export async function fetchGroupBackup(groupRef: string): Promise<ApiResult<File>> {
  const r = await apiFetch(`/groups/${groupRef}/backup`);
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  const disposition = r.headers.get("Content-Disposition") ?? "";
  const filename = /filename="([^"]+)"/u.exec(disposition)?.[1] ?? "notes.bookclub";
  return {
    ok: true,
    value: new File([await r.blob()], filename, {
      type: r.headers.get("Content-Type") ?? "application/octet-stream",
    }),
  };
}

export async function restoreGroupBackup(
  groupRef: string,
  file: File,
): Promise<ApiResult<{ notes: number; images: number; createdAt: string }>> {
  const r = await apiFetch(`/groups/${groupRef}/backup`, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  const body = await parseJson(r, RestoreBackupResponse);
  return body ? { ok: true, value: body } : { ok: false, error: "bad_response" };
}

export async function uploadAvatarImage(file: File): Promise<ApiResult<string>> {
  const compressed = await compressedImage(file, "avatar");
  if (!compressed.ok) return compressed;
  const image = compressed.value;
  const r = await apiFetch("/me/avatar", {
    method: "PUT",
    headers: { "Content-Type": image.type || "application/octet-stream" },
    body: image,
  });
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  const body = await parseJson(r, UploadImageResponse);
  return body ? { ok: true, value: body.id } : { ok: false, error: "bad_response" };
}

export async function updateClubProfile(
  groupId: string,
  displayName: string,
): Promise<ApiResult<ClubProfile>> {
  const r = await apiFetch(`/me/clubs/${encodeURIComponent(groupId)}/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  const body = await parseJson(r, ClubProfileResponse);
  return body ? { ok: true, value: body.profile } : { ok: false, error: "bad_response" };
}

export function avatarImagePath(userId: string, imageId: string): string {
  return `/users/${encodeURIComponent(userId)}/avatar/${encodeURIComponent(imageId)}`;
}

// The glyph shown in an avatar slot when a member has no picture: their first
// initial on black. Shared so the roster, account settings, and note avatars
// all fall back identically.
export function avatarInitial(name: string): string {
  return name.slice(0, 1).toUpperCase();
}

export async function fetchSource(
  groupRef: string,
  requestId?: string,
): Promise<FetchedSource | null> {
  const query = requestId ? `?sourceId=${encodeURIComponent(requestId)}` : "";
  const r = await apiFetch(`/groups/${groupRef}/book${query}`);
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
