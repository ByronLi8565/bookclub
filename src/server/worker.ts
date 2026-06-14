import { getAgentByName, routeAgentRequest } from "agents";
import { Hono } from "hono";
import { monotonicFactory } from "ulidx";
import type { Env } from "./env.ts";
import type { Identity } from "./GroupAgent.ts";
import { REGISTRY_ID } from "./GroupRegistry.ts";
import { sendInvite } from "./email.ts";
import { parseName } from "./names.ts";
import { signSession, verifySession, SESSION_TTL_MS } from "./session.ts";

export { NoteAgent } from "./NoteAgent.ts";
export { AuthAgent } from "./AuthAgent.ts";
export { GroupAgent } from "./GroupAgent.ts";
export { GroupRegistry } from "./GroupRegistry.ts";

const SESSION_COOKIE = "bc_session";

const ulid = monotonicFactory();

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

// List the groups the signed-in user belongs to (the home list).
app.get("/groups", async (c) => {
  const me = await currentIdentity(c.req.raw, c.env);
  if (!me) return c.json({ error: "unauthenticated" }, 401);
  const auth = await getAgentByName(c.env.AuthAgent, me.email);
  const groupIds = await auth.getGroupIds();
  const summaries = await Promise.all(
    groupIds.map(async (id) => (await getAgentByName(c.env.GroupAgent, id)).getSummary()),
  );
  return c.json({ groups: summaries.filter((s) => s !== null) });
});

// Create a group with a unique, write-once URL name.
app.post("/groups", async (c) => {
  const me = await currentIdentity(c.req.raw, c.env);
  if (!me) return c.json({ error: "unauthenticated" }, 401);
  const body = await readJson(c.req.raw);
  const parsed = parseName(body?.name);
  if (!parsed.ok) return c.json({ error: "invalid_name", reason: parsed.error }, 400);

  const groupId = ulid();
  const group = await getAgentByName(c.env.GroupAgent, groupId);
  const result = await group.create(parsed.name, me);
  if (!result.ok) {
    if (result.reason === "name_taken") return c.json({ error: "name_taken" }, 409);
    return c.json({ error: result.reason }, 409);
  }
  return c.json({ group: result.summary }, 201);
});

// Resolve a group by URL name, with the caller's membership.
app.get("/groups/:name", async (c) => {
  const me = await currentIdentity(c.req.raw, c.env);
  if (!me) return c.json({ error: "unauthenticated" }, 401);
  const group = await resolveGroup(c.env, c.req.param("name"));
  if (!group) return c.json({ error: "not_found" }, 404);
  const summary = await group.getSummary();
  if (!summary) return c.json({ error: "not_found" }, 404);
  const membership = await group.membership(me.id);
  return c.json({ group: summary, membership });
});

// Owner-only: invite an email to the group; deliver a redeem link.
app.post("/groups/:name/invite", async (c) => {
  const me = await currentIdentity(c.req.raw, c.env);
  if (!me) return c.json({ error: "unauthenticated" }, 401);
  const body = await readJson(c.req.raw);
  const email = normalizeEmail(body?.email);
  if (!email) return c.json({ error: "invalid_email" }, 400);

  const group = await resolveGroup(c.env, c.req.param("name"));
  if (!group) return c.json({ error: "not_found" }, 404);
  const summary = await group.getSummary();
  if (!summary) return c.json({ error: "not_found" }, 404);

  const result = await group.invite(me.id, email);
  if (!result.ok) {
    if (result.reason === "not_owner") return c.json({ error: "not_owner" }, 403);
    return c.json({ error: result.reason }, 404);
  }
  const origin = new URL(c.req.url).origin;
  const link = `${origin}/${summary.name}?invite=${result.token}`;
  await sendInvite(c.env, email, summary.displayName, link);
  return c.body(null, 204);
});

// Redeem an invite token: the signed-in caller joins the group.
app.post("/groups/:name/join", async (c) => {
  const me = await currentIdentity(c.req.raw, c.env);
  if (!me) return c.json({ error: "unauthenticated" }, 401);
  const body = await readJson(c.req.raw);
  const inviteToken = typeof body?.token === "string" ? body.token : null;
  if (!inviteToken) return c.json({ error: "invalid_request" }, 400);

  const group = await resolveGroup(c.env, c.req.param("name"));
  if (!group) return c.json({ error: "not_found" }, 404);
  const result = await group.redeem(inviteToken, me);
  if (!result.ok) {
    if (result.reason === "not_found") return c.json({ error: "not_found" }, 404);
    return c.json({ error: result.reason }, 403);
  }
  return c.json({ group: result.summary });
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

// Validate the session cookie and return the caller's identity, or null. This is
// the server-side source of truth for who a request is (never client-supplied).
async function currentIdentity(request: Request, env: Env): Promise<Identity | null> {
  const tokenValue = readSessionCookie(request);
  if (!tokenValue) return null;
  const claims = await verifySession(tokenValue, env.SESSION_HMAC_SECRET);
  if (!claims) return null;
  return { id: claims.userId, name: claims.name, email: claims.email };
}

// Resolve a URL name to its GroupAgent stub via the registry, or null if the
// name shape is illegal or unclaimed.
async function resolveGroup(env: Env, rawName: string) {
  const parsed = parseName(rawName);
  if (!parsed.ok) return null;
  const registry = await getAgentByName(env.GroupRegistry, REGISTRY_ID);
  const groupId = await registry.resolve(parsed.name.key);
  if (!groupId) return null;
  return getAgentByName(env.GroupAgent, groupId);
}

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
