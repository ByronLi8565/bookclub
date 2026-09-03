import * as Effect from "effect/Effect";
import { BOOKS_STORE, idbGet, idbPut } from "../db.ts";
import { isNative } from "../net/api.ts";
import { getNativeSource, putNativeSource } from "./nativeSourceStore.ts";

const MAX_MEMORY_SOURCES = 3;
const MAX_MEMORY_SOURCE_BYTES = 250 * 1024 * 1024;
const memorySources = new Map<string, File>();
let memorySourceBytes = 0;

function rememberedSource(sourceId: string): File | null {
  const file = memorySources.get(sourceId);
  if (file === undefined) return null;
  memorySources.delete(sourceId);
  memorySources.set(sourceId, file);
  return file;
}

function rememberSource(sourceId: string, file: File): void {
  const previous = memorySources.get(sourceId);
  if (previous !== undefined) {
    memorySourceBytes -= previous.size;
    memorySources.delete(sourceId);
  }
  if (file.size > MAX_MEMORY_SOURCE_BYTES) return;
  memorySources.set(sourceId, file);
  memorySourceBytes += file.size;
  while (memorySources.size > MAX_MEMORY_SOURCES || memorySourceBytes > MAX_MEMORY_SOURCE_BYTES) {
    const oldest = memorySources.entries().next().value;
    if (oldest === undefined) break;
    memorySources.delete(oldest[0]);
    memorySourceBytes -= oldest[1].size;
  }
}

// Book blobs are a convenience cache on the web (best-effort IndexedDB), but the
// durable, offline-guaranteed store on native (see nativeSourceStore.ts). The
// public surface is identical; only the backend differs per platform.
export async function getCachedSource(sourceId: string): Promise<File | null> {
  if (isNative) return getNativeSource(sourceId);

  const memory = rememberedSource(sourceId);
  if (memory !== null) return memory;

  const value = await Effect.runPromise(
    idbGet<File | Blob>(BOOKS_STORE, sourceId).pipe(Effect.orElseSucceed(() => null)),
  );
  if (!value) return null;
  const file =
    value instanceof File
      ? value
      : new File([value], `${sourceId}.epub`, { type: "application/epub+zip" });
  rememberSource(sourceId, file);
  return file;
}

export async function putCachedSource(sourceId: string, file: File): Promise<void> {
  if (isNative) {
    await putNativeSource(sourceId, file);
    return;
  }
  rememberSource(sourceId, file);
  await Effect.runPromise(idbPut(BOOKS_STORE, sourceId, file).pipe(Effect.ignore));
}
