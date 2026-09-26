import * as Schema from "effect/Schema";
import { cookieValue } from "./cookies.ts";
import { signToken, verifyToken } from "./signedToken.ts";

// The passkey authentication ceremony spans two requests, but no session yet
// exists to anchor server-side state. Rather than add a store, the challenge is
// signed into a short-lived HttpOnly cookie: stateless, tamper-evident, and
// scoped to the email that requested it so the verify step can't be replayed
// against a different account. The signature cannot be revoked, so the account
// records each challenge it accepts and refuses a second use within the TTL.
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
  cookieHeader: string | null | undefined,
  secret: string,
): Promise<{ email: string; challenge: string; exp: number } | null> {
  const token = cookieValue(cookieHeader, CHALLENGE_COOKIE);
  return token ? await verifyToken(ChallengePayloadSchema, token, secret) : null;
}
