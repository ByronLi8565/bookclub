import { sha256Hex } from "../../shared/util.ts";
import type { Env } from "../env.ts";

// EPUB bytes live in R2 keyed by their content hash, so the same book uploaded
// to two groups is stored once (dedup across groups — decision 13). Access is
// gated per group at the route layer; this module only moves bytes.

export const EPUB_CONTENT_TYPE = "application/epub+zip";

// Store book bytes under their content hash (no-op if already present) and
// return the hash, which becomes the group's bound `sourceId`.
export async function storeBook(env: Env, bytes: ArrayBuffer): Promise<string> {
  const hash = await sha256Hex(bytes);
  const existing = await env.BOOKS.head(hash);
  if (!existing) await env.BOOKS.put(hash, bytes);
  return hash;
}

// Fetch a stored book by content hash, or null if absent.
export function getBook(env: Env, hash: string): Promise<R2ObjectBody | null> {
  return env.BOOKS.get(hash);
}
