import { getAgentByName, routeAgentRequest } from "agents";
import type { Env } from "./env.ts";
import { signSession, verifySession, SESSION_TTL_MS } from "./session.ts";

export { NoteAgent } from "./NoteAgent.ts";
export { AuthAgent } from "./AuthAgent.ts";

const SESSION_COOKIE = "bc_session";

// Route order: /auth/* HTTP routes first, then agent (websocket + rpc) traffic,
// then the Vite-built client assets. Phase B will migrate this switchboard to
// Hono; for now it stays a plain fetch handler (step-6-plan).
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/auth/")) return handleAuth(request, env, url.pathname);

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    // In `wrangler dev` there is no ASSETS binding: the client is served by the
    // vite dev server on :5173, which proxies /agents and /auth here. Only the
    // deployed worker serves the built client.
    if (!env.ASSETS) {
      return new Response("Run the client via the vite dev server (npm run dev).", { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },
};

// oxlint-disable-next-line require-await -- dispatcher mixes sync and async handlers
async function handleAuth(request: Request, env: Env, pathname: string): Promise<Response> {
  if (pathname === "/auth/start" && request.method === "POST") return authStart(request, env);
  if (pathname === "/auth/verify" && request.method === "POST") return authVerify(request, env);
  if (pathname === "/auth/signout" && request.method === "POST") return authSignout();
  if (pathname === "/auth/me" && request.method === "GET") return authMe(request, env);
  return new Response("Not found", { status: 404 });
}

// Normalize an email for use as both the AuthAgent key and the stored address.
function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  // Deliberately permissive: a single `@` with non-empty sides. Real validation
  // happens by whether the code is received.
  return /^[^@\s]+@[^@\s]+$/u.test(email) ? email : null;
}

async function authStart(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const email = normalizeEmail(body?.email);
  if (!email) return json({ error: "invalid_email" }, 400);

  const auth = await getAgentByName(env.AuthAgent, email);
  const sent = await auth.startLogin(email);
  // Rate limited: tell the client so it can back off. Otherwise 204.
  if (!sent) return json({ error: "rate_limited" }, 429);
  return new Response(null, { status: 204 });
}

async function authVerify(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const email = normalizeEmail(body?.email);
  const code = typeof body?.code === "string" ? body.code.trim() : null;
  const displayName = typeof body?.displayName === "string" ? body.displayName : undefined;
  if (!email || !code) return json({ error: "invalid_request" }, 400);

  const auth = await getAgentByName(env.AuthAgent, email);
  const result = await auth.verifyLogin(email, code, displayName);
  if (!result.ok) return json({ error: result.reason }, 400);

  const exp = Date.now() + SESSION_TTL_MS;
  const token = await signSession(
    { userId: result.user.id, email: result.user.email, name: result.user.displayName, exp },
    env.SESSION_HMAC_SECRET,
  );
  return json(
    { user: { id: result.user.id, email: result.user.email, name: result.user.displayName } },
    200,
    { "Set-Cookie": sessionCookie(token) },
  );
}

function authSignout(): Response {
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearedCookie() } });
}

async function authMe(request: Request, env: Env): Promise<Response> {
  const token = readSessionCookie(request);
  if (!token) return json({ error: "unauthenticated" }, 401);
  const claims = await verifySession(token, env.SESSION_HMAC_SECRET);
  if (!claims) return json({ error: "unauthenticated" }, 401);
  return json({ user: { id: claims.userId, email: claims.email, name: claims.name } });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function sessionCookie(token: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function clearedCookie(): string {
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
