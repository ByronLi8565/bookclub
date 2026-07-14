import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

// IndexedDB upgrades run cumulatively; preserve existing stores when bumping DB_VERSION.
const DB_NAME = "bookclub";
const DB_VERSION = 2;

export const BOOKS_STORE = "books";
export const NOTES_STORE = "notes";

export class PersistError extends Data.TaggedError("PersistError")<{
  readonly op: string;
  readonly cause: unknown;
}> {}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.addEventListener("upgradeneeded", () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BOOKS_STORE)) db.createObjectStore(BOOKS_STORE);
      if (!db.objectStoreNames.contains(NOTES_STORE)) db.createObjectStore(NOTES_STORE);
    });
    req.addEventListener("success", () => resolve(req.result));
    req.addEventListener("error", () => reject(req.error));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function request<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest,
): Effect.Effect<T, PersistError> {
  return Effect.tryPromise({
    try: async () => {
      const db = await open();
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = run(tx.objectStore(store));
        req.addEventListener("success", () => resolve(req.result as T));
        req.addEventListener("error", () => reject(req.error));
      });
    },
    catch: (cause) => new PersistError({ op: `${mode}:${store}`, cause }),
  });
}

export function idbGet<T>(store: string, key: string): Effect.Effect<T | undefined, PersistError> {
  return request<T | undefined>(store, "readonly", (s) => s.get(key));
}

export function idbPut(
  store: string,
  key: string,
  value: unknown,
): Effect.Effect<void, PersistError> {
  return request<IDBValidKey>(store, "readwrite", (s) => s.put(value, key)).pipe(Effect.asVoid);
}
