import { base64urlDecode, base64urlEncode } from "../../shared/base64url.ts";
import { constantTimeEqualBytes } from "../../shared/crypto.ts";

// The passkey authentication ceremony spans two requests, but no session yet
// exists to anchor server-side state. Rather than add a store, the challenge is
// signed into a short-lived HttpOnly cookie: stateless, tamper-evident, and
// scoped to the email that requested it so the verify step can't be replayed
// against a different account.
const CHALLENGE_COOKIE = "bc_pk_challenge";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const encoder = new TextEncoder();

interface ChallengePayload {
  email: string;
  challenge: string;
  exp: number;
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sign(payload: ChallengePayload, secret: string): Promise<string> {
  const encoded = base64urlEncode(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(encoded));
  return `${encoded}.${base64urlEncode(new Uint8Array(sig))}`;
}

async function verify(token: string, secret: string): Promise<ChallengePayload | null> {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const key = await hmacKey(secret);
  let expected: ArrayBuffer;
  let provided: Uint8Array;
  try {
    expected = await crypto.subtle.sign("HMAC", key, encoder.encode(encoded));
    provided = base64urlDecode(signature);
  } catch {
    return null;
  }
  if (!constantTimeEqualBytes(new Uint8Array(expected), provided)) return null;
  try {
    const payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(encoded)),
    ) as ChallengePayload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function challengeCookie(
  email: string,
  challenge: string,
  secret: string,
): Promise<string> {
  const token = await sign({ email, challenge, exp: Date.now() + CHALLENGE_TTL_MS }, secret);
  const maxAge = Math.floor(CHALLENGE_TTL_MS / 1000);
  return `${CHALLENGE_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearedChallengeCookie(): string {
  return `${CHALLENGE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function readChallenge(
  request: Request,
  secret: string,
): Promise<{ email: string; challenge: string } | null> {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  let token: string | null = null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CHALLENGE_COOKIE) token = rest.join("=");
  }
  if (!token) return null;
  const payload = await verify(token, secret);
  return payload ? { email: payload.email, challenge: payload.challenge } : null;
}
