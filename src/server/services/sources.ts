import { sha256Hex } from "../../shared/crypto.ts";
import {
  contentTypeFor,
  sniffSourceKind,
  sourceKindFor,
  type SourceKind,
} from "../../shared/types/sources.ts";
import type { Env } from "../env.ts";

export interface StoredSource {
  id: string;
  kind: SourceKind;
  contentType: string;
  size: number;
}

export type StoreSourceResult =
  | { ok: true; source: StoredSource }
  | { ok: false; reason: "unsupported_type" | "empty" };

export async function storeSource(
  env: Env,
  bytes: ArrayBuffer,
  contentType: string | null,
): Promise<StoreSourceResult> {
  if (bytes.byteLength === 0) return { ok: false, reason: "empty" };

  const kind = sniffSourceKind(bytes) ?? sourceKindFor(contentType);
  if (!kind) return { ok: false, reason: "unsupported_type" };

  const id = await sha256Hex(bytes);
  const existing = await env.BOOKS.head(id);
  if (!existing) await env.BOOKS.put(id, bytes);
  return {
    ok: true,
    source: { id, kind, contentType: contentTypeFor(kind), size: bytes.byteLength },
  };
}

export function getSource(env: Env, id: string): Promise<R2ObjectBody | null> {
  return env.BOOKS.get(id);
}
