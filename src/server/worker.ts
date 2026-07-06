import { getAgentByName, routeAgentRequest } from "agents";
import { Hono, type Context } from "hono";
import type { Env } from "./env.ts";
import { registerGroupRoutes } from "./routes/groupRoutes.ts";
import { registerUserRoutes } from "./routes/userRoutes.ts";
import { registerAuthRoutes } from "./routes/authRoutes.ts";
import { clearedCookie, currentIdentity, mintSessionCookie, publicUser } from "./auth/cookies.ts";
import { normalizeEmail } from "../shared/email.ts";
import { readJson } from "./http.ts";
import { backupAll, listBackups, pruneBackups, restoreFrom } from "./backup.ts";
import { constantTimeEqual } from "../shared/crypto.ts";

export { NoteAgent } from "./state/NoteAgent.ts";
export { AuthAgent } from "./state/AuthAgent.ts";
export { GroupAgent } from "./state/GroupAgent.ts";
export { GroupRegistry } from "./state/GroupRegistry.ts";

const app = new Hono<{ Bindings: Env }>();

function isDevAuth(env: Env): boolean {
  return !env.EMAIL || !env.EMAIL_FROM;
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

registerAuthRoutes(app);
registerUserRoutes(app);
registerGroupRoutes(app);

// Admin endpoints for manual Durable Object state backup/restore. Authorized
// either by a machine bearer token (ADMIN_API_TOKEN, used by deploy/CI) or by
// the configured ADMIN_EMAIL signed-session identity (a logged-in browser).
async function isAdmin(c: Context<{ Bindings: Env }>): Promise<boolean> {
  const token = c.env.ADMIN_API_TOKEN;
  if (token) {
    const header = c.req.header("Authorization");
    const provided = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    if (provided && constantTimeEqual(provided, token)) return true;
  }
  const admin = c.env.ADMIN_EMAIL;
  if (!admin) return false;
  const me = await currentIdentity(c.req.raw, c.env);
  return me?.email === admin;
}

app.post("/admin/backup", async (c) => {
  if (!(await isAdmin(c))) return c.json({ error: "forbidden" }, 403);
  return c.json(await backupAll(c.env));
});

app.get("/admin/backups", async (c) => {
  if (!(await isAdmin(c))) return c.json({ error: "forbidden" }, 403);
  return c.json({ backups: await listBackups(c.env) });
});

app.post("/admin/prune", async (c) => {
  if (!(await isAdmin(c))) return c.json({ error: "forbidden" }, 403);
  return c.json(await pruneBackups(c.env));
});

app.post("/admin/restore", async (c) => {
  if (!(await isAdmin(c))) return c.json({ error: "forbidden" }, 403);
  const body = await readJson(c.req.raw);
  const key = typeof body?.key === "string" ? body.key : null;
  if (!key) return c.json({ error: "missing_key" }, 400);
  try {
    return c.json(await restoreFrom(c.env, key));
  } catch (error) {
    return c.json({ error: "restore_failed", reason: String(error) }, 404);
  }
});

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

  const assetResponse = await c.env.ASSETS.fetch(c.req.raw);

  // Hashed build assets live under /assets/. When one is missing (e.g. an old
  // client requesting a chunk from a superseded deploy), the SPA fallback would
  // otherwise hand back index.html as text/html — which browsers reject with a
  // MIME-type error when loading it as a module. Return an honest 404 instead.
  const pathname = new URL(c.req.url).pathname;
  if (
    pathname.startsWith("/assets/") &&
    assetResponse.headers.get("content-type")?.includes("text/html")
  ) {
    return c.text("not found", 404);
  }

  return assetResponse;
});

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> =>
    app.fetch(request, env, ctx),
  // Scheduled (cron) Durable Object state backup to R2.
  scheduled: (_controller: ScheduledController, env: Env, ctx: ExecutionContext): void => {
    ctx.waitUntil(
      backupAll(env)
        .then((r) => console.log("scheduled backup ok", r))
        .catch((error: unknown) => console.error("scheduled backup failed", error)),
    );
  },
};
