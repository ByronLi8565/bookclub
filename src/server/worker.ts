import { getAgentByName, routeAgentRequest } from "agents";
import { Hono, type Context } from "hono";
import type { User as AuthUser } from "./agents/AuthAgent.ts";
import type { Env } from "./env.ts";
import { registerGroupRoutes } from "./routes/groupRoutes.ts";
import { clearedCookie, currentIdentity, sessionCookie } from "./auth/cookies.ts";
import { normalizeEmail, readJson } from "./util/http.ts";
import { signSession, SESSION_TTL_MS } from "./auth/session.ts";

export { NoteAgent } from "./agents/NoteAgent.ts";
export { AuthAgent } from "./agents/AuthAgent.ts";
export { GroupAgent } from "./agents/GroupAgent.ts";
export { GroupRegistry } from "./agents/GroupRegistry.ts";

// The worker is a Hono app. Route order matters: explicit /auth/* routes are
// matched first; the catch-all then hands websocket + rpc traffic to the agents
// router and finally falls back to the Vite-built client assets.
const app = new Hono<{ Bindings: Env }>();

// In local dev, email delivery isn't configured, so the login code is only
// logged to the console. Skip the round-trip entirely and sign the user in from
// /auth/start. Never true in production (EMAIL/EMAIL_FROM are set there).
function isDevAuth(env: Env): boolean {
  return !env.EMAIL || !env.EMAIL_FROM;
}

// Sign a fresh session for a user and return the Set-Cookie header value.
async function mintSessionCookie(env: Env, user: AuthUser): Promise<string> {
  const exp = Date.now() + SESSION_TTL_MS;
  const token = await signSession(
    { userId: user.id, email: user.email, name: user.displayName, exp },
    env.SESSION_HMAC_SECRET,
  );
  return sessionCookie(token);
}

// The user shape exposed to the client.
function publicUser(user: AuthUser): { id: string; email: string; name: string } {
  return { id: user.id, email: user.email, name: user.displayName };
}

app.post("/auth/start", async (c) => {
  const body = await readJson(c.req.raw);
  const email = normalizeEmail(body?.email);
  if (!email) return c.json({ error: "invalid_email" }, 400);

  const auth = await getAgentByName(c.env.AuthAgent, email);

  // Dev shortcut: sign in immediately, no code required.
  if (isDevAuth(c.env)) {
    const user = await auth.devLogin(email);
    c.header("Set-Cookie", await mintSessionCookie(c.env, user));
    return c.json({ devSignedIn: true, user: publicUser(user) });
  }

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

  c.header("Set-Cookie", await mintSessionCookie(c.env, result.user));
  return c.json({ user: publicUser(result.user) });
});

app.post("/auth/signout", (c) => {
  c.header("Set-Cookie", clearedCookie());
  return c.body(null, 204);
});

app.get("/auth/me", async (c) => {
  const me = await currentIdentity(c.req.raw, c.env);
  if (!me) return c.json({ error: "unauthenticated" }, 401);
  return c.json({ user: { id: me.id, email: me.email, name: me.name } });
});

// All /groups* routes live in their own module to keep this file focused.
registerGroupRoutes(app);

// Connect gate (decision 6): the NoteAgent is keyed by groupId, so the :name
// segment of its agent route is a groupId. Reject the websocket/rpc unless the
// caller has a valid session AND is a member of that group — non-members never
// reach the agent and never receive its broadcasts.
const noteGate = async (c: Context<{ Bindings: Env }>): Promise<Response> => {
  const me = await currentIdentity(c.req.raw, c.env);
  if (!me) return c.text("unauthenticated", 401);
  const groupId = c.req.param("groupId");
  if (!groupId) return c.text("not found", 404);
  const group = await getAgentByName(c.env.GroupAgent, groupId);
  const { isMember } = await group.membership(me.id);
  if (!isMember) return c.text("forbidden", 403);
  const agentResponse = await routeAgentRequest(c.req.raw, c.env);
  return agentResponse ?? c.text("not found", 404);
};
app.all("/agents/note-agent/:groupId", noteGate);
app.all("/agents/note-agent/:groupId/*", noteGate);

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
