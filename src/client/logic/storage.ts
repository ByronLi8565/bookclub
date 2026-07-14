export function readLocal<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

export function writeLocal(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function removeLocal(key: string): void {
  localStorage.removeItem(key);
}

export function readVersionedLocal<T>(key: string, legacyKey: string): T | null {
  const current = readLocal<T>(key);
  if (current !== null) return current;
  const legacy = readLocal<T>(legacyKey);
  if (legacy === null) return null;
  writeLocal(key, legacy);
  removeLocal(legacyKey);
  return legacy;
}
