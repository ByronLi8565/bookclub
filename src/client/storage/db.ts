import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Note } from "../notes/types.ts";

interface BookclubDB extends DBSchema {
  notes: { key: string; value: Note; indexes: { "by-source": string } };
}

let dbPromise: Promise<IDBPDatabase<BookclubDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<BookclubDB>> {
  if (!dbPromise) {
    dbPromise = openDB<BookclubDB>("bookclub", 3, {
      upgrade(db) {
        // Hard cutover: the standalone Step 1 highlights store and the interim
        // cards store are gone, absorbed into notes. Local data is discarded.
        // Those stores aren't in the current schema, so reach past the typed
        // handle to drop them.
        const raw = db as unknown as IDBDatabase;
        for (const stale of ["highlights", "cards"]) {
          if (raw.objectStoreNames.contains(stale)) raw.deleteObjectStore(stale);
        }
        const store = db.createObjectStore("notes", { keyPath: "id" });
        store.createIndex("by-source", "sourceId");
      },
    });
  }
  return dbPromise;
}
