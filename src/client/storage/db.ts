import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Note } from "../notes.ts";

interface BookclubDB extends DBSchema {
  notes: { key: string; value: Note; indexes: { "by-source": string } };
}

let dbPromise: Promise<IDBPDatabase<BookclubDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<BookclubDB>> {
  if (!dbPromise) {
    dbPromise = openDB<BookclubDB>("bookclub", 3, {
      upgrade(db) {
        const store = db.createObjectStore("notes", { keyPath: "id" });
        store.createIndex("by-source", "sourceId");
      },
    });
  }
  return dbPromise;
}
