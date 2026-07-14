import * as Effect from "effect/Effect";
import { useSyncExternalStore } from "react";
import { apiFetch } from "../net/api.ts";
import { decode } from "../../../shared/schema.ts";
import {
  DEFAULT_USER_PREFS,
  mergeUserPrefs,
  UserPrefsResponse,
  type UserPrefs,
} from "../../../shared/types/userPrefs.ts";
import { readVersionedLocal, writeLocal } from "../storage.ts";

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
  void Effect.runPromise(syncUserPrefs()).catch(() => {});
}

export function setNotesPref<K extends keyof UserPrefs["notes"]>(
  key: K,
  value: UserPrefs["notes"][K],
): void {
  publish({ ...prefs, notes: { ...prefs.notes, [key]: value } });
  void Effect.runPromise(syncUserPrefs()).catch(() => {});
}

export function hydrateUserPrefs(): Effect.Effect<UserPrefs> {
  return Effect.tryPromise(async () => {
    const response = await apiFetch("/me/prefs");
    if (!response.ok) throw new Error(`http_${response.status}`);
    const body = decode(UserPrefsResponse, await response.json());
    if (!body) throw new Error("bad_response");
    const next = mergeUserPrefs(body.prefs);
    publish(next);
    return next;
  }).pipe(Effect.orElseSucceed(() => prefs));
}

function syncUserPrefs(): Effect.Effect<UserPrefs> {
  return Effect.tryPromise(async () => {
    const response = await apiFetch("/me/prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefs }),
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const body = decode(UserPrefsResponse, await response.json());
    if (!body) throw new Error("bad_response");
    const next = mergeUserPrefs(body.prefs);
    publish(next);
    return next;
  });
}

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
