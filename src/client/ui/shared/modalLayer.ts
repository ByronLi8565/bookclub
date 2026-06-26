import { useSyncExternalStore } from "react";

// Tracks how many modals are currently open so that global reader hotkeys
// (page turns, fit, search, …) can be suppressed while a modal has focus.
let openCount = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

// Register an open modal; returns a release function (call on unmount).
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
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): boolean {
  return openCount > 0;
}

export function useAnyModalOpen(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
