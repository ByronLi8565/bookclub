import * as Schema from "effect/Schema";
import { signToken, verifyToken } from "./signedToken.ts";

// The passkey authentication ceremony spans two requests, but no session yet
// exists to anchor server-side state. Rather than add a store, the challenge is
// signed into a short-lived HttpOnly cookie: stateless, tamper-evident, and
// scoped to the email that requested it so the verify step can't be replayed
// against a different account.
const CHALLENGE_COOKIE = "bc_pk_challenge";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const ChallengePayloadSchema = Schema.Struct({
  email: Schema.String,
  challenge: Schema.String,
  exp: Schema.Number,
});

export async function challengeCookie(
  email: string,
  challenge: string,
  secret: string,
): Promise<string> {
  const token = await signToken({ email, challenge, exp: Date.now() + CHALLENGE_TTL_MS }, secret);
  const maxAge = Math.floor(CHALLENGE_TTL_MS / 1000);
  return `${CHALLENGE_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
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
  const payload = await verifyToken(ChallengePayloadSchema, token, secret);
  return payload ? { email: payload.email, challenge: payload.challenge } : null;
}
