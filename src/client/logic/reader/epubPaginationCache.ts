import * as Schema from "effect/Schema";
import { decode } from "../../../shared/schema.ts";
import { readLocal, writeLocal } from "../storage.ts";
import type { EpubPagination } from "./epubPagination.ts";

const STORAGE_KEY = "bookclub.epubPagination:v1";
const MAX_CACHED_PAGINATIONS = 12;

const StoredPagination = Schema.Struct({
  key: Schema.String,
  total: Schema.Number,
  divisor: Schema.Number,
  offsets: Schema.Array(Schema.Tuple([Schema.Number, Schema.Number])),
  lastUsedAt: Schema.Number,
});
const StoredPaginations = Schema.Array(StoredPagination);
type StoredPagination = typeof StoredPagination.Type;

const memory = new Map<string, EpubPagination>();

function stored(): readonly StoredPagination[] {
  return decode(StoredPaginations, readLocal(STORAGE_KEY)) ?? [];
}

function remember(key: string, pagination: EpubPagination): void {
  memory.delete(key);
  memory.set(key, pagination);
  while (memory.size > MAX_CACHED_PAGINATIONS) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) return;
    memory.delete(oldest);
  }
}

export function getCachedEpubPagination(key: string): EpubPagination | null {
  const cached = memory.get(key);
  if (cached !== undefined) {
    remember(key, cached);
    return cached;
  }
  const persisted = stored().find((entry) => entry.key === key);
  if (persisted === undefined) return null;
  const pagination = {
    total: persisted.total,
    divisor: persisted.divisor,
    offsetByIndex: new Map(persisted.offsets),
  };
  remember(key, pagination);
  return pagination;
}

export function putCachedEpubPagination(key: string, pagination: EpubPagination): void {
  remember(key, pagination);
  const entries = [
    ...stored().filter((entry) => entry.key !== key),
    {
      key,
      total: pagination.total,
      divisor: pagination.divisor,
      offsets: [...pagination.offsetByIndex],
      lastUsedAt: Date.now(),
    },
  ]
    .toSorted((a, b) => b.lastUsedAt - a.lastUsedAt)
    .slice(0, MAX_CACHED_PAGINATIONS);
  try {
    writeLocal(STORAGE_KEY, entries);
  } catch {
    // Storage is an optimization; private mode or quota pressure must not turn
    // a completed pagination measurement into a reader failure.
  }
}
