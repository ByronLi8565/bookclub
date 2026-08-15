import { useSyncExternalStore } from "react";

let openCount = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function pushModal(): () => void {
  openCount += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openCount = Math.max(0, openCount - 1);
    emit();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): boolean {
  return openCount > 0;
}

export function useAnyModalOpen(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
