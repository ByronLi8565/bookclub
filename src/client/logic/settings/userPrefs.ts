import * as Effect from "effect/Effect";
import { useSyncExternalStore } from "react";
import {
  DEFAULT_USER_PREFS,
  mergeUserPrefs,
  UserPrefsResponse,
  type UserPrefs,
} from "../../../shared/types/userPrefs.ts";
import { readVersionedLocal, writeLocal } from "../storage.ts";
import { decodeJson, request, type ApiRequestError } from "../net/request.ts";

export type {
  PdfPageLayout,
  ReadingPositionOpenPolicy,
  SmartArrows,
  UserPrefs,
} from "../../../shared/types/userPrefs.ts";

const STORAGE_KEY = "bookclub.userPrefs:v1";
const LEGACY_STORAGE_KEY = "bookclub.userPrefs";

function load(): UserPrefs {
  return mergeUserPrefs(
    readVersionedLocal<Partial<UserPrefs>>(STORAGE_KEY, LEGACY_STORAGE_KEY) ?? DEFAULT_USER_PREFS,
  );
}

function save(next: UserPrefs): void {
  writeLocal(STORAGE_KEY, next);
}

let prefs = load();
const listeners = new Set<() => void>();

function publish(next: UserPrefs): void {
  prefs = next;
  save(next);
  for (const listener of listeners) listener();
}

function getUserPrefs(): UserPrefs {
  return prefs;
}

export function setReaderPref<K extends keyof UserPrefs["reader"]>(
  key: K,
  value: UserPrefs["reader"][K],
): void {
  publish({ ...prefs, reader: { ...prefs.reader, [key]: value } });
  Effect.runFork(syncUserPrefs().pipe(Effect.ignore));
}

export function setNotesPref<K extends keyof UserPrefs["notes"]>(
  key: K,
  value: UserPrefs["notes"][K],
): void {
  publish({ ...prefs, notes: { ...prefs.notes, [key]: value } });
  Effect.runFork(syncUserPrefs().pipe(Effect.ignore));
}

const requestUserPrefs = Effect.fn("UserPrefs.request")(function* (
  method: "GET" | "PUT",
): Effect.fn.Return<UserPrefs, ApiRequestError> {
  const response = yield* request("UserPrefs.request", "/me/prefs", {
    method,
    ...(method === "PUT"
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefs }) }
      : {}),
  });
  const body = yield* decodeJson("UserPrefs.decode", response, UserPrefsResponse);
  const next = mergeUserPrefs(body.prefs);
  publish(next);
  return next;
});

export const hydrateUserPrefs = Effect.fn("UserPrefs.hydrate")(function* () {
  return yield* requestUserPrefs("GET").pipe(Effect.orElseSucceed(() => prefs));
});

const syncUserPrefs = Effect.fn("UserPrefs.sync")(function* () {
  return yield* requestUserPrefs("PUT");
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useUserPrefs(): UserPrefs {
  return useSyncExternalStore(subscribe, getUserPrefs, getUserPrefs);
}

export function useReaderPrefs(): UserPrefs["reader"] {
  return useUserPrefs().reader;
}

export function useNotesPrefs(): UserPrefs["notes"] {
  return useUserPrefs().notes;
}
