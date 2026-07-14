import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

// IndexedDB upgrades run cumulatively; preserve existing stores when bumping DB_VERSION.
const DB_NAME = "bookclub";
const DB_VERSION = 2;

export const BOOKS_STORE = "books";
export const NOTES_STORE = "notes";

export class PersistError extends Schema.TaggedErrorClass<PersistError>()(
  "IndexedDb.PersistError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

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

const request = Effect.fn("IndexedDb.request")(function* <T>(
  store: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Effect.fn.Return<T, PersistError> {
  return yield* Effect.tryPromise({
    try: async () => {
      const db = await open();
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const dbRequest = run(tx.objectStore(store));
        dbRequest.addEventListener("success", () => resolve(dbRequest.result));
        dbRequest.addEventListener("error", () => reject(dbRequest.error));
      });
    },
    catch: (cause) => new PersistError({ operation: `IndexedDb.${mode}.${store}`, cause }),
  });
});

export const idbGet = Effect.fn("IndexedDb.get")(function* <T>(
  store: string,
  key: string,
): Effect.fn.Return<T | undefined, PersistError> {
  return yield* request<T | undefined>(store, "readonly", (objectStore) => objectStore.get(key));
});

export const idbPut = Effect.fn("IndexedDb.put")(function* (
  store: string,
  key: string,
  value: unknown,
): Effect.fn.Return<void, PersistError> {
  yield* request<IDBValidKey>(store, "readwrite", (objectStore) => objectStore.put(value, key));
});
