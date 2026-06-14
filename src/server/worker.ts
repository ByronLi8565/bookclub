import { getAgentByName, routeAgentRequest } from "agents";
import { Hono } from "hono";
import type { Env } from "./env.ts";
import { signSession, verifySession, SESSION_TTL_MS } from "./session.ts";

export { NoteAgent } from "./NoteAgent.ts";
export { AuthAgent } from "./AuthAgent.ts";

const SESSION_COOKIE = "bc_session";

// The worker is a Hono app. Route order matters: explicit /auth/* routes are
// matched first; the catch-all then hands websocket + rpc traffic to the agents
// router and finally falls back to the Vite-built client assets.
const app = new Hono<{ Bindings: Env }>();

app.post("/auth/start", async (c) => {
  const body = await readJson(c.req.raw);
  const email = normalizeEmail(body?.email);
  if (!email) return c.json({ error: "invalid_email" }, 400);

  const auth = await getAgentByName(c.env.AuthAgent, email);
  const sent = await auth.startLogin(email);
  // Rate limited: tell the client so it can back off. Otherwise 204.
  if (!sent) return c.json({ error: "rate_limited" }, 429);
  return c.body(null, 204);
});

app.post("/auth/verify", async (c) => {
  const body = await readJson(c.req.raw);
  const email = normalizeEmail(body?.email);
  const code = typeof body?.code === "string" ? body.code.trim() : null;
  const displayName = typeof body?.displayName === "string" ? body.displayName : undefined;
  if (!email || !code) return c.json({ error: "invalid_request" }, 400);

  const auth = await getAgentByName(c.env.AuthAgent, email);
  const result = await auth.verifyLogin(email, code, displayName);
  if (!result.ok) return c.json({ error: result.reason }, 400);

  const exp = Date.now() + SESSION_TTL_MS;
  const token = await signSession(
    { userId: result.user.id, email: result.user.email, name: result.user.displayName, exp },
    c.env.SESSION_HMAC_SECRET,
  );
  c.header("Set-Cookie", sessionCookie(token));
  return c.json({
    user: { id: result.user.id, email: result.user.email, name: result.user.displayName },
  });
});

app.post("/auth/signout", (c) => {
  c.header("Set-Cookie", clearedCookie());
  return c.body(null, 204);
});

app.get("/auth/me", async (c) => {
  const token = readSessionCookie(c.req.raw);
  if (!token) return c.json({ error: "unauthenticated" }, 401);
  const claims = await verifySession(token, c.env.SESSION_HMAC_SECRET);
  if (!claims) return c.json({ error: "unauthenticated" }, 401);
  return c.json({ user: { id: claims.userId, email: claims.email, name: claims.name } });
});

// Everything else: agent (websocket + rpc) traffic, then the client assets.
app.all("*", async (c) => {
  const agentResponse = await routeAgentRequest(c.req.raw, c.env);
  if (agentResponse) return agentResponse;

  // In `wrangler dev` there is no ASSETS binding: the client is served by the
  // vite dev server on :5173, which proxies /agents and /auth here. Only the
  // deployed worker serves the built client.
  if (!c.env.ASSETS) {
    return c.text("Run the client via the vite dev server (npm run dev).", 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;

// Normalize an email for use as both the AuthAgent key and the stored address.
function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  // Deliberately permissive: a single `@` with non-empty sides. Real validation
  // happens by whether the code is received.
  return /^[^@\s]+@[^@\s]+$/u.test(email) ? email : null;
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
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
