import { EPUB_CONTENT_TYPE } from "../../server/services/books.ts";

// A small IndexedDB cache for book bytes, keyed by sourceId (the content hash, so
// entries never go stale). Lets a page reload reuse the local copy instead of
// re-downloading from R2. All operations are best-effort: any failure (private
// mode, quota, unsupported) degrades gracefully to a network fetch.

const DB_NAME = "bookclub";
const STORE = "books";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.addEventListener("upgradeneeded", () => req.result.createObjectStore(STORE));
    req.addEventListener("success", () => resolve(req.result));
    req.addEventListener("error", () => reject(req.error));
  });
}

export async function getCachedBook(sourceId: string): Promise<File | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(sourceId);
      req.addEventListener("success", () => {
        const blob = req.result as Blob | undefined;
        resolve(blob ? new File([blob], `${sourceId}.epub`, { type: EPUB_CONTENT_TYPE }) : null);
      });
      req.addEventListener("error", () => reject(req.error));
    });
  } catch {
    return null;
  }
}

export async function deleteCachedBook(sourceId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(sourceId);
      tx.addEventListener("complete", () => resolve());
      tx.addEventListener("error", () => reject(tx.error));
    });
  } catch {
    // Best-effort: ignore cache delete failures.
  }
}

export async function putCachedBook(sourceId: string, file: File): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(file, sourceId);
      tx.addEventListener("complete", () => resolve());
      tx.addEventListener("error", () => reject(tx.error));
    });
  } catch {
    // Best-effort: ignore cache write failures.
  }
}
