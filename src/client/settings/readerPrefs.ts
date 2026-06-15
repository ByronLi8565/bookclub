import { useSyncExternalStore } from "react";




export type SmartArrows = "off" | "smooth" | "instant";

export interface ReaderPrefs {
  smartArrows: SmartArrows;
}

const STORAGE_KEY = "bookclub.readerPrefs";
const DEFAULTS: ReaderPrefs = { smartArrows: "instant" };

function load(): ReaderPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ReaderPrefs>) };
  } catch {
    return DEFAULTS;
  }
}

let prefs = load();
const listeners = new Set<() => void>();

export function getReaderPrefs(): ReaderPrefs {
  return prefs;
}

export function setReaderPref<K extends keyof ReaderPrefs>(key: K, value: ReaderPrefs[K]): void {
  prefs = { ...prefs, [key]: value };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {


  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReaderPrefs(): ReaderPrefs {
  return useSyncExternalStore(subscribe, getReaderPrefs, getReaderPrefs);
}
