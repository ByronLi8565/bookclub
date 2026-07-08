export function readLocal<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

export function writeLocal(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function removeLocal(key: string): void {
  localStorage.removeItem(key);
}
