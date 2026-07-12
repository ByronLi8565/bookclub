import { getAgentByName, routeAgentRequest } from "agents";
import { Hono, type Context } from "hono";
import type { Env } from "./env.ts";
import { registerGroupRoutes } from "./routes/groupRoutes.ts";
import { registerUserRoutes } from "./routes/userRoutes.ts";
import { registerAuthRoutes } from "./routes/authRoutes.ts";
import { clearedCookie, currentIdentity, publicUser, sessionCredentials } from "./auth/cookies.ts";
import { normalizeEmail } from "../shared/email.ts";
import { readJson } from "./http.ts";
import { backupAll, listBackups, pruneBackups, restoreFrom } from "./backup.ts";
import { constantTimeEqual } from "../shared/crypto.ts";
import { isDevAuth } from "./auth/devAuth.ts";

export { NoteAgent } from "./state/NoteAgent.ts";
export { AuthAgent } from "./state/AuthAgent.ts";
export { GroupAgent } from "./state/GroupAgent.ts";
export { GroupRegistry } from "./state/GroupRegistry.ts";

const app = new Hono<{ Bindings: Env }>();

// Native uses bearer auth from distinct webview origins; don't allow credentials.
const NATIVE_ORIGINS = new Set(["capacitor://localhost", "https://localhost", "http://localhost"]);

app.use("*", async (c, next) => {
  const origin = c.req.header("Origin");
  const allowed = origin !== undefined && NATIVE_ORIGINS.has(origin);

  if (c.req.method === "OPTIONS" && allowed) {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
    });
  }

  await next();

  if (allowed) {
    c.res.headers.set("Access-Control-Allow-Origin", origin);
    c.res.headers.append("Vary", "Origin");
  }
});

app.post("/auth/start", async (c) => {
  const body = await readJson(c.req.raw);
  const email = normalizeEmail(body?.email);
  if (!email) return c.json({ error: "invalid_email" }, 400);

  const auth = await getAgentByName(c.env.AuthAgent, email);

  if (isDevAuth(c.env)) {
    const user = await auth.devLogin(email);
    const { cookie, token } = await sessionCredentials(c.env, user);
    c.header("Set-Cookie", cookie);
    return c.json({ devSignedIn: true, user: publicUser(user), token });
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

  const { cookie, token } = await sessionCredentials(c.env, result.user);
  c.header("Set-Cookie", cookie);
  return c.json({ user: publicUser(result.user), token });
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

  // Missing hashed assets must 404 instead of receiving the SPA fallback HTML.
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
  scheduled: (_controller: ScheduledController, env: Env, ctx: ExecutionContext): void => {
    ctx.waitUntil(
      backupAll(env)
        .then((r) => console.log("scheduled backup ok", r))
        .catch((error: unknown) => console.error("scheduled backup failed", error)),
    );
  },
};
