// Group names live in the URL (`/<name>`) and are the global, write-once key for
// a group. This module is the single place that defines what a legal name is.
//
// Rules (decision 12): a name is normalized to lowercase for the registry key
// while the original casing is kept as a display label; it must be URL-safe and
// must never collide with a real route, so a reserved-word list is enforced.

// Routes and asset paths a group name must never shadow. Anything the worker
// (or the SPA fallback) serves at a top-level path belongs here.
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

// Lowercase alphanumerics and single interior hyphens: starts and ends with an
// alphanumeric, no leading/trailing/double hyphen.
const SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export type NameError = "empty" | "too_short" | "too_long" | "bad_charset" | "reserved";

export interface NormalizedName {
  // The lowercase registry key.
  key: string;
  // The original casing, kept as the display label.
  display: string;
}

export type NameResult = { ok: true; name: NormalizedName } | { ok: false; error: NameError };

// Validate and normalize a raw, user-supplied group name. The input must already
// be URL-safe (no spaces) — the display label is just its original casing.
export function parseName(raw: unknown): NameResult {
  if (typeof raw !== "string") return { ok: false, error: "empty" };
  const display = raw.trim();
  if (display === "") return { ok: false, error: "empty" };

  const key = display.toLowerCase();
  if (key.length < MIN_LENGTH) return { ok: false, error: "too_short" };
  if (key.length > MAX_LENGTH) return { ok: false, error: "too_long" };
  if (!SHAPE.test(key)) return { ok: false, error: "bad_charset" };
  if (RESERVED.has(key)) return { ok: false, error: "reserved" };

  return { ok: true, name: { key, display } };
}

// Whether a path segment could ever be a legal group name. Used by routing to
// decide if `/<segment>` should resolve a group at all.
export function isPossibleName(segment: string): boolean {
  const key = segment.toLowerCase();
  return (
    key.length >= MIN_LENGTH && key.length <= MAX_LENGTH && SHAPE.test(key) && !RESERVED.has(key)
  );
}
