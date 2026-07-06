// Small, safe localStorage helpers for read-through offline caches. Kept
// synchronous and best-effort (matching userPrefs/readingPositions): a private
// window or full disk degrades to "no cache", never a crash.
export function readLocal<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {}
}
