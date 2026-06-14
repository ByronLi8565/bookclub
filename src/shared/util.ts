import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

export class HashError extends Data.TaggedError("HashError")<{ cause: unknown }> {}

// SHA-256 a byte buffer and return its lower-case hex digest.
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Content-address a file or blob: sha256(bytes) -> source id.
export const hashFile = (file: Blob): Effect.Effect<string, HashError> =>
  Effect.tryPromise({
    try: async () => sha256Hex(await file.arrayBuffer()),
    catch: (cause) => new HashError({ cause }),
  });

// Constant-time equality for hex strings (e.g. hashed login codes).
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a.codePointAt(i) ?? 0) ^ (b.codePointAt(i) ?? 0);
  return diff === 0;
}

// Constant-time equality for raw byte arrays (e.g. HMAC signatures).
export function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

// Base64url encode without trailing padding.
export function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCodePoint(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

// Base64url decode (tolerates missing padding).
export function base64urlDecode(text: string): Uint8Array {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.codePointAt(i) ?? 0;
  return bytes;
}

// Normalize an email address for use as a lookup key or stored address.
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  // Deliberately permissive: a single `@` with non-empty sides.
  return /^[^@\s]+@[^@\s]+$/u.test(email) ? email : null;
}

// Escape HTML special characters in plain text before injecting it into markup.
export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// Human-readable byte size (e.g. "1.4 MB").
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
