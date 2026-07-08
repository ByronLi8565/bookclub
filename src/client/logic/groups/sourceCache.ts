import * as Effect from "effect/Effect";
import { BOOKS_STORE, idbDelete, idbGet, idbPut } from "../db.ts";
import { isNative } from "../net/api.ts";
import { deleteNativeSource, getNativeSource, putNativeSource } from "./nativeSourceStore.ts";

// Book blobs are a convenience cache on the web (best-effort IndexedDB), but the
// durable, offline-guaranteed store on native (see nativeSourceStore.ts). The
// public surface is identical; only the backend differs per platform.
export async function getCachedSource(sourceId: string): Promise<File | null> {
  if (isNative) return getNativeSource(sourceId);

  const value = await Effect.runPromise(
    idbGet<File | Blob>(BOOKS_STORE, sourceId).pipe(Effect.orElseSucceed(() => null)),
  );
  if (!value) return null;
  return value instanceof File
    ? value
    : new File([value], `${sourceId}.epub`, { type: "application/epub+zip" });
}

export async function deleteCachedSource(sourceId: string): Promise<void> {
  if (isNative) {
    await deleteNativeSource(sourceId);
    return;
  }
  await Effect.runPromise(idbDelete(BOOKS_STORE, sourceId).pipe(Effect.ignore));
}

export async function putCachedSource(sourceId: string, file: File): Promise<void> {
  if (isNative) {
    await putNativeSource(sourceId, file);
    return;
  }
  await Effect.runPromise(idbPut(BOOKS_STORE, sourceId, file).pipe(Effect.ignore));
}
