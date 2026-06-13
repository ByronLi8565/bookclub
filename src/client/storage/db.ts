import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Highlight } from "../highlights/types.ts";

interface BookclubDB extends DBSchema {
  highlights: {
    key: string;
    value: Highlight;
    indexes: { "by-source": string };
  };
}

let dbPromise: Promise<IDBPDatabase<BookclubDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<BookclubDB>> {
  if (!dbPromise) {
    dbPromise = openDB<BookclubDB>("bookclub", 1, {
      upgrade(db) {
        const store = db.createObjectStore("highlights", { keyPath: "id" });
        store.createIndex("by-source", "sourceId");
      },
    });
  }
  return dbPromise;
}
