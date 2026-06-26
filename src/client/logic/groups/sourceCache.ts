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

export async function getCachedSource(sourceId: string): Promise<File | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(sourceId);
      req.addEventListener("success", () => {
        const value = req.result as File | Blob | undefined;
        if (!value) return resolve(null);

        resolve(
          value instanceof File
            ? value
            : new File([value], `${sourceId}.epub`, { type: "application/epub+zip" }),
        );
      });
      req.addEventListener("error", () => reject(req.error));
    });
  } catch {
    return null;
  }
}

export async function deleteCachedSource(sourceId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(sourceId);
      tx.addEventListener("complete", () => resolve());
      tx.addEventListener("error", () => reject(tx.error));
    });
  } catch {}
}

export async function putCachedSource(sourceId: string, file: File): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(file, sourceId);
      tx.addEventListener("complete", () => resolve());
      tx.addEventListener("error", () => reject(tx.error));
    });
  } catch {}
}
