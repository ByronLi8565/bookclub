import { useSyncExternalStore } from "react";

// Connectivity signal derived from the browser's online/offline events. Note
// `navigator.onLine === true` only means "there is a network interface", not
// "the server is reachable" — so we treat `false` as authoritative (definitely
// offline) and `true` as optimistic. Actual request failures still drive
// per-feature offline fallbacks.
let online = typeof navigator === "undefined" ? true : navigator.onLine;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (online === next) return;
  online = next;
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => set(true));
  window.addEventListener("offline", () => set(false));
}

export function isOnline(): boolean {
  return online;
}

export function subscribeOnline(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => online,
    () => true,
  );
}
