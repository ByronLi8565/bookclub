import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { useSyncExternalStore } from "react";
import {
  DEFAULT_USER_PREFS,
  mergeUserPrefs,
  UserPrefsPatch,
  UserPrefsResponse,
  type UserPrefs,
} from "../../../shared/types/userPrefs.ts";
import { decode } from "../../../shared/schema.ts";
import { readVersionedLocal, writeLocal } from "../storage.ts";
import { decodeJson, request, type ApiRequestError } from "../net/request.ts";
import { isOnline, subscribeOnline } from "../net/online.ts";

export type {
  PdfPageLayout,
  ReadingPositionOpenPolicy,
  SmartArrows,
  UserPrefs,
} from "../../../shared/types/userPrefs.ts";

const STORAGE_KEY = "bookclub.userPrefs:v1";
const LEGACY_STORAGE_KEY = "bookclub.userPrefs";

function load(): UserPrefs {
  const stored = readVersionedLocal<unknown>(STORAGE_KEY, LEGACY_STORAGE_KEY);
  return mergeUserPrefs(decode(UserPrefsPatch, stored) ?? DEFAULT_USER_PREFS);
}

function save(next: UserPrefs): void {
  writeLocal(STORAGE_KEY, next);
}

let prefs = load();
let revision = 0;
let syncGeneration = 0;
let syncFiber: Fiber.Fiber<void, never> | null = null;
const listeners = new Set<() => void>();

function publish(next: UserPrefs): void {
  revision += 1;
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
  const next = { ...prefs, reader: { ...prefs.reader, [key]: value } };
  publish(next);
  startSync(next);
}

export function setNotesPref<K extends keyof UserPrefs["notes"]>(
  key: K,
  value: UserPrefs["notes"][K],
): void {
  const next = { ...prefs, notes: { ...prefs.notes, [key]: value } };
  publish(next);
  startSync(next);
}

const requestUserPrefs = Effect.fn("UserPrefs.request")(function* (
  method: "GET" | "PUT",
  next?: UserPrefs,
): Effect.fn.Return<UserPrefs, ApiRequestError> {
  const response = yield* request("UserPrefs.request", "/me/prefs", {
    method,
    ...(method === "PUT"
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefs: next }) }
      : {}),
  });
  const body = yield* decodeJson("UserPrefs.decode", response, UserPrefsResponse);
  return mergeUserPrefs(body.prefs);
});

export const hydrateUserPrefs = Effect.fn("UserPrefs.hydrate")(function* () {
  const startedAt = revision;
  const next = yield* requestUserPrefs("GET").pipe(Effect.orElseSucceed(() => prefs));
  if (revision === startedAt) publish(next);
  return prefs;
});

const syncUserPrefs = Effect.fn("UserPrefs.sync")(function* (next: UserPrefs) {
  yield* requestUserPrefs("PUT", next);
});

function startSync(next: UserPrefs): void {
  const generation = ++syncGeneration;
  if (syncFiber) Effect.runFork(Fiber.interrupt(syncFiber));
  syncFiber = Effect.runFork(
    syncUserPrefs(next).pipe(
      Effect.ignore,
      Effect.ensuring(
        Effect.sync(() => {
          if (syncGeneration === generation) syncFiber = null;
        }),
      ),
    ),
  );
}

subscribeOnline(() => {
  if (isOnline()) startSync(prefs);
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
