import type { Env } from "./env.ts";
import type { Identity } from "./GroupAgent.ts";
import { SESSION_TTL_MS, verifySession } from "./session.ts";

// The session cookie name. Shared by the worker (set/clear/read on HTTP) and the
// agent connect gate (read off the websocket handshake — see ADR 0001).
export const SESSION_COOKIE = "bc_session";

// Serialize the session cookie carrying `token`, expiring with the session TTL.
export function sessionCookie(token: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

// Serialize a cookie that immediately clears the session.
export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

// Pull the raw session token out of a request's Cookie header, or null.
export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return null;
}

// Validate the session cookie and return the caller's identity, or null. This is
// the server-side source of truth for who a request is; it is never derived from
// a client-supplied field.
export async function currentIdentity(request: Request, env: Env): Promise<Identity | null> {
  const tokenValue = readSessionCookie(request);
  if (!tokenValue) return null;
  const claims = await verifySession(tokenValue, env.SESSION_HMAC_SECRET);
  if (!claims) return null;
  return { id: claims.userId, name: claims.name, email: claims.email };
}
