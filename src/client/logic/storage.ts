export function readLocal(key: string) {
  try {
    const raw = localStorage.getItem(key);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return value;
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

export function readVersionedLocal(key: string, legacyKey: string) {
  const current = readLocal(key);
  if (current !== null) return current;
  const legacy = readLocal(legacyKey);
  if (legacy === null) return null;
  writeLocal(key, legacy);
  removeLocal(legacyKey);
  return legacy;
}
