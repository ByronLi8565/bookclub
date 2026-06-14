import type { Env } from "./env.ts";
import type { Identity } from "./GroupAgent.ts";
import { verifySession } from "./session.ts";

// The session cookie name. Shared by the worker (set/clear/read on HTTP) and the
// agent connect gate (read off the websocket handshake — see ADR 0001).
export const SESSION_COOKIE = "bc_session";

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
