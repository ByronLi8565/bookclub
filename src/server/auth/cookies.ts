import type { Env } from "../env.ts";
import type { Identity } from "../state/GroupAgent.ts";
import type { User } from "../state/AuthAgent.ts";
import { SESSION_TTL_MS, signSession, verifySession } from "./session.ts";

const SESSION_COOKIE = "bc_session";

export function publicUser(user: User) {
  return user.avatarImageId
    ? { id: user.id, email: user.email, name: user.displayName, avatarImageId: user.avatarImageId }
    : { id: user.id, email: user.email, name: user.displayName };
}

export async function mintSessionToken(env: Env, user: User): Promise<string> {
  const exp = Date.now() + SESSION_TTL_MS;
  return await signSession(
    { userId: user.id, email: user.email, name: user.displayName, exp },
    env.SESSION_HMAC_SECRET,
  );
}

export async function sessionCredentials(
  env: Env,
  user: User,
): Promise<{ cookie: string; token: string }> {
  const token = await mintSessionToken(env, user);
  return { cookie: sessionCookie(token), token };
}

function sessionCookie(token: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/** One cookie's value out of a `Cookie` header. */
export function cookieValue(header: string | null | undefined, name: string): string | null {
  for (const part of header?.split(";") ?? []) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

interface CredentialHeaders {
  readonly cookie?: string | null | undefined;
  readonly authorization?: string | null | undefined;
}

// The web app carries a session cookie; the native app sends the same token as a bearer.
function sessionToken({ cookie, authorization }: CredentialHeaders): string | null {
  const fromCookie = cookieValue(cookie, SESSION_COOKIE);
  if (fromCookie) return fromCookie;
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim() || null;
  }
  return null;
}

async function identityFor(token: string | null, env: Env): Promise<Identity | null> {
  if (!token) return null;
  const claims = await verifySession(token, env.SESSION_HMAC_SECRET);
  return claims ? { id: claims.userId, name: claims.name, email: claims.email } : null;
}

/** The caller of a structured HTTP route. A `?token=` query is never a credential
 *  here: a URL is logged and shared far more readily than a header. */
export const currentIdentity = (headers: CredentialHeaders, env: Env): Promise<Identity | null> =>
  identityFor(sessionToken(headers), env);

/** The caller opening a NoteAgent socket. A native WebSocket cannot set headers,
 *  so only this upgrade also accepts the session as a `?token=` query. */
export const socketIdentity = (request: Request, env: Env): Promise<Identity | null> =>
  identityFor(
    sessionToken({
      cookie: request.headers.get("cookie"),
      authorization: request.headers.get("authorization"),
    }) ||
      new URL(request.url).searchParams.get("token")?.trim() ||
      null,
    env,
  );
