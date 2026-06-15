const RESERVED = new Set([
  "auth",
  "agents",
  "assets",
  "books",
  "invite",
  "api",
  "static",
  "favicon.ico",
  "robots.txt",
  "index.html",
  "admin",
  "about",
  "new",
]);

const MIN_LENGTH = 2;
const MAX_LENGTH = 32;

const SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export type NameError = "empty" | "too_short" | "too_long" | "bad_charset" | "reserved";

export interface NormalizedName {
  key: string;
  display: string;
}

export type NameResult = { ok: true; name: NormalizedName } | { ok: false; error: NameError };

export function parseName(raw: unknown): NameResult {
  if (typeof raw !== "string") return { ok: false, error: "empty" };
  const display = raw.trim();
  if (display === "") return { ok: false, error: "empty" };

  const key = display.toLowerCase().replaceAll(/\s+/gu, "-");
  if (key.length < MIN_LENGTH) return { ok: false, error: "too_short" };
  if (key.length > MAX_LENGTH) return { ok: false, error: "too_long" };
  if (!SHAPE.test(key)) return { ok: false, error: "bad_charset" };
  if (RESERVED.has(key)) return { ok: false, error: "reserved" };

  return { ok: true, name: { key, display } };
}

export function isPossibleName(segment: string): boolean {
  const key = segment.toLowerCase();
  return (
    key.length >= MIN_LENGTH && key.length <= MAX_LENGTH && SHAPE.test(key) && !RESERVED.has(key)
  );
}
