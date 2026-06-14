// Stateless session tokens: an HMAC-signed claims blob carried in a cookie.
// There is no server-side session store — verification is pure crypto over the
// token plus the worker's secret. Tradeoff: revocation is weak until `exp`
// (accepted for v1, see step-6-plan decision 2).

import { base64urlDecode, base64urlEncode, constantTimeEqualBytes } from "../../shared/util.ts";

export interface SessionClaims {
  userId: string;
  email: string;
  name: string;
  // Expiry as epoch milliseconds.
  exp: number;
}

// 30 days. Long-lived because revocation is weak; short enough to bound stale
// identity after sign-out on another device.
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

// Sign claims into a `<payload>.<signature>` token, both base64url.
export async function signSession(claims: SessionClaims, secret: string): Promise<string> {
  const payload = base64urlEncode(encoder.encode(JSON.stringify(claims)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${base64urlEncode(new Uint8Array(sig))}`;
}

// Verify a token and return its claims, or null if the signature is bad, the
// shape is wrong, or it has expired.
export async function verifySession(token: string, secret: string): Promise<SessionClaims | null> {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const key = await hmacKey(secret);
  let expected: ArrayBuffer;
  try {
    expected = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  } catch {
    return null;
  }
  let provided: Uint8Array;
  try {
    provided = base64urlDecode(signature);
  } catch {
    return null;
  }
  if (!constantTimeEqualBytes(new Uint8Array(expected), provided)) return null;

  let claims: SessionClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(base64urlDecode(payload))) as SessionClaims;
  } catch {
    return null;
  }
  if (typeof claims.exp !== "number" || claims.exp < Date.now()) return null;
  return claims;
}
