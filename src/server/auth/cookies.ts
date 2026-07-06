import type { Env } from "../env.ts";
import type { Identity } from "../state/GroupAgent.ts";
import type { User } from "../state/AuthAgent.ts";
import { SESSION_TTL_MS, signSession, verifySession } from "./session.ts";

const SESSION_COOKIE = "bc_session";

export function publicUser(user: User): { id: string; email: string; name: string } {
  return { id: user.id, email: user.email, name: user.displayName };
}

export async function mintSessionCookie(env: Env, user: User): Promise<string> {
  const exp = Date.now() + SESSION_TTL_MS;
  const token = await signSession(
    { userId: user.id, email: user.email, name: user.displayName, exp },
    env.SESSION_HMAC_SECRET,
  );
  return sessionCookie(token);
}

export function sessionCookie(token: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return null;
}

export async function currentIdentity(request: Request, env: Env): Promise<Identity | null> {
  const tokenValue = readSessionCookie(request);
  if (!tokenValue) return null;
  const claims = await verifySession(tokenValue, env.SESSION_HMAC_SECRET);
  if (!claims) return null;
  return { id: claims.userId, name: claims.name, email: claims.email };
}
