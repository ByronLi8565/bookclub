import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";
import {
  DEFAULT_USER_PREFS,
  mergeUserPrefs,
  UserPrefsResponse,
  type UserPrefs,
} from "../../shared/types/userPrefs.ts";

export type {
  ReadingPositionOpenPolicy,
  SmartArrows,
  UserPrefs,
} from "../../shared/types/userPrefs.ts";

const STORAGE_KEY = "bookclub.userPrefs";

function decode<S extends Schema.Top>(schema: S, value: unknown): Schema.Schema.Type<S> | null {
  try {
    return Schema.decodeUnknownSync(schema as unknown as Schema.Decoder<unknown, never>)(
      value,
    ) as Schema.Schema.Type<S>;
  } catch {
    return null;
  }
}

function load(): UserPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_USER_PREFS;
    return mergeUserPrefs(JSON.parse(raw) as Partial<UserPrefs>);
  } catch {
    return DEFAULT_USER_PREFS;
  }
}

function save(next: UserPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
}

let prefs = load();
const listeners = new Set<() => void>();

function publish(next: UserPrefs): void {
  prefs = next;
  save(next);
  for (const listener of listeners) listener();
}

export function getUserPrefs(): UserPrefs {
  return prefs;
}

export function setReaderPref<K extends keyof UserPrefs["reader"]>(
  key: K,
  value: UserPrefs["reader"][K],
): void {
  publish({ ...prefs, reader: { ...prefs.reader, [key]: value } });
  void Effect.runPromise(syncUserPrefs()).catch(() => {});
}

export function hydrateUserPrefs(): Effect.Effect<UserPrefs> {
  return Effect.tryPromise(async () => {
    const response = await fetch("/me/prefs");
    if (!response.ok) throw new Error(`http_${response.status}`);
    const body = decode(UserPrefsResponse, await response.json());
    if (!body) throw new Error("bad_response");
    const next = mergeUserPrefs(body.prefs);
    publish(next);
    return next;
  }).pipe(Effect.orElseSucceed(() => prefs));
}

export function syncUserPrefs(): Effect.Effect<UserPrefs> {
  return Effect.tryPromise(async () => {
    const response = await fetch("/me/prefs", {
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

export function useUserPrefs(): UserPrefs {
  return useSyncExternalStore(subscribe, getUserPrefs, getUserPrefs);
}

export function useReaderPrefs(): UserPrefs["reader"] {
  return useUserPrefs().reader;
}
