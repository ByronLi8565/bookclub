import * as Effect from "effect/Effect";
import { BOOKS_STORE, idbDelete, idbGet, idbPut } from "../db.ts";

// Book blobs are a non-critical convenience cache, so failures here stay
// best-effort (resolve null / no-op) rather than surfacing to the user.
export async function getCachedSource(sourceId: string): Promise<File | null> {
  const value = await Effect.runPromise(
    idbGet<File | Blob>(BOOKS_STORE, sourceId).pipe(Effect.orElseSucceed(() => null)),
  );
  if (!value) return null;
  return value instanceof File
    ? value
    : new File([value], `${sourceId}.epub`, { type: "application/epub+zip" });
}

export async function deleteCachedSource(sourceId: string): Promise<void> {
  await Effect.runPromise(idbDelete(BOOKS_STORE, sourceId).pipe(Effect.ignore));
}

export async function putCachedSource(sourceId: string, file: File): Promise<void> {
  await Effect.runPromise(idbPut(BOOKS_STORE, sourceId, file).pipe(Effect.ignore));
}
