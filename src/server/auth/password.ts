import { base64urlDecode, base64urlEncode } from "../../shared/base64url.ts";
import { constantTimeEqualBytes } from "../../shared/crypto.ts";

// Password storage uses PBKDF2-HMAC-SHA256. Workers has no native bcrypt/scrypt,
// and PBKDF2 is the only password-suitable KDF exposed by WebCrypto. The
// production Workers runtime HARD-CAPS PBKDF2 at 100,000 iterations and throws
// above it (local workerd/`wrangler dev` does NOT enforce this, so a higher
// count passes tests but 500s once deployed). 100k is therefore the ceiling,
// not merely a tuning choice.
export const PBKDF2_ITERATIONS = 100_000;
const HASH_BYTES = 32;
const SALT_BYTES = 16;

export interface PasswordHash {
  hash: string;
  salt: string;
  iterations: number;
}

const encoder = new TextEncoder();

async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const bits = await derive(password, salt, PBKDF2_ITERATIONS);
  return {
    hash: base64urlEncode(bits),
    salt: base64urlEncode(salt),
    iterations: PBKDF2_ITERATIONS,
  };
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  let salt: Uint8Array<ArrayBuffer>;
  let expected: Uint8Array;
  try {
    salt = Uint8Array.from(base64urlDecode(stored.salt));
    expected = base64urlDecode(stored.hash);
  } catch {
    return false;
  }
  const actual = await derive(password, salt, stored.iterations);
  return constantTimeEqualBytes(actual, expected);
}
