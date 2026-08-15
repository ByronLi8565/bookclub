import * as Encoding from "effect/Encoding";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { constantTimeEqualBytes } from "../../shared/crypto.ts";
import { hmacKey } from "./hmac.ts";

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

const ChallengePayloadSchema = Schema.Struct({
  email: Schema.String,
  challenge: Schema.String,
  exp: Schema.Number,
});

async function sign(payload: ChallengePayload, secret: string): Promise<string> {
  const encoded = Encoding.encodeBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(encoded));
  return `${encoded}.${Encoding.encodeBase64Url(new Uint8Array(sig))}`;
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
    provided = Result.getOrThrow(Encoding.decodeBase64Url(signature));
  } catch {
    return null;
  }
  if (!constantTimeEqualBytes(new Uint8Array(expected), provided)) return null;
  try {
    const payload = Option.getOrNull(
      Schema.decodeUnknownOption(ChallengePayloadSchema)(
        JSON.parse(new TextDecoder().decode(Result.getOrThrow(Encoding.decodeBase64Url(encoded)))),
      ),
    );
    if (payload === null || payload.exp < Date.now()) return null;
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
