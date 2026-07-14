import type { Env } from "../env.ts";
import type { Identity } from "../state/GroupAgent.ts";
import type { User } from "../state/AuthAgent.ts";
import { SESSION_TTL_MS, signSession, verifySession } from "./session.ts";

const SESSION_COOKIE = "bc_session";

export function publicUser(user: User): {
  id: string;
  email: string;
  name: string;
  avatarImageId?: string;
} {
  return {
    id: user.id,
    email: user.email,
    name: user.displayName,
    ...(user.avatarImageId ? { avatarImageId: user.avatarImageId } : {}),
  };
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

// Native uses bearer auth for HTTP and `?token=` for WebSocket upgrades.
function readSessionToken(request: Request): string | null {
  const cookie = readSessionCookie(request);
  if (cookie) return cookie;

  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim() || null;

  const queryToken = new URL(request.url).searchParams.get("token");
  return queryToken?.trim() || null;
}

export async function currentIdentity(request: Request, env: Env): Promise<Identity | null> {
  const tokenValue = readSessionToken(request);
  if (!tokenValue) return null;
  const claims = await verifySession(tokenValue, env.SESSION_HMAC_SECRET);
  if (!claims) return null;
  return { id: claims.userId, name: claims.name, email: claims.email };
}
