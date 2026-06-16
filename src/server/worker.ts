import { getAgentByName, routeAgentRequest } from "agents";
import { Hono, type Context } from "hono";
import type { User as AuthUser } from "./agents/AuthAgent.ts";
import type { Env } from "./env.ts";
import { registerGroupRoutes } from "./routes/groupRoutes.ts";
import { registerUserRoutes } from "./routes/userRoutes.ts";
import { clearedCookie, currentIdentity, sessionCookie } from "./auth/cookies.ts";
import { normalizeEmail, readJson } from "./util/http.ts";
import { signSession, SESSION_TTL_MS } from "./auth/session.ts";

export { NoteAgent } from "./agents/NoteAgent.ts";
export { AuthAgent } from "./agents/AuthAgent.ts";
export { GroupAgent } from "./agents/GroupAgent.ts";
export { GroupRegistry } from "./agents/GroupRegistry.ts";

const app = new Hono<{ Bindings: Env }>();

function isDevAuth(env: Env): boolean {
  return !env.EMAIL || !env.EMAIL_FROM;
}

async function mintSessionCookie(env: Env, user: AuthUser): Promise<string> {
  const exp = Date.now() + SESSION_TTL_MS;
  const token = await signSession(
    { userId: user.id, email: user.email, name: user.displayName, exp },
    env.SESSION_HMAC_SECRET,
  );
  return sessionCookie(token);
}

function publicUser(user: AuthUser): { id: string; email: string; name: string } {
  return { id: user.id, email: user.email, name: user.displayName };
}

app.post("/auth/start", async (c) => {
  const body = await readJson(c.req.raw);
  const email = normalizeEmail(body?.email);
  if (!email) return c.json({ error: "invalid_email" }, 400);

  const auth = await getAgentByName(c.env.AuthAgent, email);

  if (isDevAuth(c.env)) {
    const user = await auth.devLogin(email);
    c.header("Set-Cookie", await mintSessionCookie(c.env, user));
    return c.json({ devSignedIn: true, user: publicUser(user) });
  }

  const sent = await auth.startLogin(email);
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

registerUserRoutes(app);
registerGroupRoutes(app);

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

app.all("*", async (c) => {
  const agentResponse = await routeAgentRequest(c.req.raw, c.env);
  if (agentResponse) return agentResponse;

  if (!c.env.ASSETS) {
    return c.text("Run the client via the vite dev server (npm run dev).", 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
