import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Card } from "../cards/types.ts";

interface BookclubDB extends DBSchema {
  cards: { key: string; value: Card; indexes: { "by-source": string } };
}

let dbPromise: Promise<IDBPDatabase<BookclubDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<BookclubDB>> {
  if (!dbPromise) {
    dbPromise = openDB<BookclubDB>("bookclub", 2, {
      upgrade(db) {
        // Hard cutover from Step 1: the standalone highlights store is gone,
        // absorbed into cards. Local Step 1 data is discarded. The old store
        // isn't in the current schema, so reach past the typed handle to drop it.
        const raw = db as unknown as IDBDatabase;
        if (raw.objectStoreNames.contains("highlights")) {
          raw.deleteObjectStore("highlights");
        }
        const store = db.createObjectStore("cards", { keyPath: "id" });
        store.createIndex("by-source", "sourceId");
      },
    });
  }
  return dbPromise;
}
