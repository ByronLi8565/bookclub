import { monotonicFactory } from "ulidx";
import type { Env } from "../env.ts";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const IMAGE_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

const ulid = monotonicFactory();

export interface StoredImage {
  id: string;
  contentType: string;
  size: number;
}

export type StoreImageResult =
  | { ok: true; image: StoredImage }
  | { ok: false; reason: "empty" | "too_large" | "unsupported_type" };

export function imageKey(groupId: string, imageId: string): string {
  return `${groupId}/${imageId}`;
}

export function validImageId(imageId: string): boolean {
  return IMAGE_ID_PATTERN.test(imageId);
}

export async function storeImage(
  env: Env,
  groupId: string,
  bytes: ArrayBuffer,
  contentType: string | null,
): Promise<StoreImageResult> {
  if (bytes.byteLength === 0) return { ok: false, reason: "empty" };
  if (bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, reason: "too_large" };
  const type = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!IMAGE_TYPES.has(type)) return { ok: false, reason: "unsupported_type" };

  const id = ulid();
  await env.IMAGES.put(imageKey(groupId, id), bytes, {
    httpMetadata: { contentType: type },
    customMetadata: { groupId, size: String(bytes.byteLength) },
  });
  return { ok: true, image: { id, contentType: type, size: bytes.byteLength } };
}

export function getImage(env: Env, groupId: string, imageId: string): Promise<R2ObjectBody | null> {
  return env.IMAGES.get(imageKey(groupId, imageId));
}

export async function deleteImagesForScope(env: Env, scope: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.IMAGES.list({ prefix: `${scope}/`, cursor });
    if (page.objects.length > 0) await env.IMAGES.delete(page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
