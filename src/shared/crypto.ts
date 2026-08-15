import * as Encoding from "effect/Encoding";

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Encoding.encodeHex(new Uint8Array(digest));
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a.codePointAt(i) ?? 0) ^ (b.codePointAt(i) ?? 0);
  return diff === 0;
}

export function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

// A random string of `length` characters drawn from `alphabet`.
export function randomId(length: number, alphabet: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}
