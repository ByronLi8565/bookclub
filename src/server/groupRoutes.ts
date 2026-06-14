import { getAgentByName } from "agents";
import type { Context, Hono } from "hono";
import { monotonicFactory } from "ulidx";
import { EPUB_CONTENT_TYPE, getBook, storeBook } from "./books.ts";
import { sendInvite } from "./email.ts";
import type { Env } from "./env.ts";
import { REGISTRY_ID } from "./GroupRegistry.ts";
import { currentIdentity } from "./identity.ts";
import { normalizeEmail, readJson } from "./http.ts";
import { parseName } from "./names.ts";

const ulid = monotonicFactory();

type Ctx = Context<{ Bindings: Env }>;

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

// Map a rename result reason to an HTTP response (shared by the club- and
// book-title routes).
function renameError(c: Ctx, reason: string): Response {
  if (reason === "not_member") return c.json({ error: "not_member" }, 403);
  if (reason === "empty") return c.json({ error: "empty" }, 400);
  return c.json({ error: reason }, 404);
}

// Register all /groups* routes on the app.
export function registerGroupRoutes(app: Hono<{ Bindings: Env }>): void {
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
    // The roster is members-only.
    const members = membership.isMember ? await group.roster() : [];
    return c.json({ group: summary, membership, members });
  });

  // Owner-only: get (or, with ?rotate=1, regenerate) the group's open invite link.
  app.post("/groups/:name/invite-link", async (c) => {
    const me = await currentIdentity(c.req.raw, c.env);
    if (!me) return c.json({ error: "unauthenticated" }, 401);
    const group = await resolveGroup(c.env, c.req.param("name"));
    if (!group) return c.json({ error: "not_found" }, 404);
    const summary = await group.getSummary();
    if (!summary) return c.json({ error: "not_found" }, 404);

    const rotate = c.req.query("rotate") === "1";
    const result = rotate
      ? await group.rotateOpenInvite(me.id)
      : await group.ensureOpenInvite(me.id);
    if (!result.ok) {
      if (result.reason === "not_owner") return c.json({ error: "not_owner" }, 403);
      return c.json({ error: result.reason }, 404);
    }
    const origin = new URL(c.req.url).origin;
    return c.json({
      token: result.token,
      link: `${origin}/${summary.name}?invite=${result.token}`,
    });
  });

  // Any member: rename the club (its display name; the URL name is write-once).
  app.put("/groups/:name/title", async (c) => {
    const me = await currentIdentity(c.req.raw, c.env);
    if (!me) return c.json({ error: "unauthenticated" }, 401);
    const body = await readJson(c.req.raw);
    const title = typeof body?.title === "string" ? body.title : null;
    if (title === null) return c.json({ error: "invalid_request" }, 400);

    const group = await resolveGroup(c.env, c.req.param("name"));
    if (!group) return c.json({ error: "not_found" }, 404);
    const result = await group.renameGroup(me.id, title);
    return result.ok ? c.json({ group: result.summary }) : renameError(c, result.reason);
  });

  // Any member: set a display title for a bound book.
  app.put("/groups/:name/book/title", async (c) => {
    const me = await currentIdentity(c.req.raw, c.env);
    if (!me) return c.json({ error: "unauthenticated" }, 401);
    const body = await readJson(c.req.raw);
    const sourceId = typeof body?.sourceId === "string" ? body.sourceId : null;
    const title = typeof body?.title === "string" ? body.title : null;
    if (!sourceId || title === null) return c.json({ error: "invalid_request" }, 400);

    const group = await resolveGroup(c.env, c.req.param("name"));
    if (!group) return c.json({ error: "not_found" }, 404);
    const result = await group.renameBook(me.id, sourceId, title);
    return result.ok ? c.json({ group: result.summary }) : renameError(c, result.reason);
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

  // Owner-only: upload the group's book. Bytes are stored in R2 by content hash
  // (dedup) and the hash is bound to the group as its source (decision 13).
  app.put("/groups/:name/book", async (c) => {
    const me = await currentIdentity(c.req.raw, c.env);
    if (!me) return c.json({ error: "unauthenticated" }, 401);
    const group = await resolveGroup(c.env, c.req.param("name"));
    if (!group) return c.json({ error: "not_found" }, 404);
    const summary = await group.getSummary();
    if (!summary) return c.json({ error: "not_found" }, 404);
    if (summary.ownerId !== me.id) return c.json({ error: "not_owner" }, 403);

    const bytes = await c.req.arrayBuffer();
    if (bytes.byteLength === 0) return c.json({ error: "empty" }, 400);
    const hash = await storeBook(c.env, bytes);
    await group.addSource(me.id, hash);
    return c.json({ hash });
  });

  // Member-only: stream the group's bound book from R2. 404 until the owner has
  // uploaded one.
  app.get("/groups/:name/book", async (c) => {
    const me = await currentIdentity(c.req.raw, c.env);
    if (!me) return c.json({ error: "unauthenticated" }, 401);
    const group = await resolveGroup(c.env, c.req.param("name"));
    if (!group) return c.json({ error: "not_found" }, 404);
    const summary = await group.getSummary();
    if (!summary) return c.json({ error: "not_found" }, 404);
    const { isMember } = await group.membership(me.id);
    if (!isMember) return c.json({ error: "forbidden" }, 403);

    const hash = summary.sources[0];
    if (!hash) return c.json({ error: "no_book" }, 404);
    const object = await getBook(c.env, hash);
    if (!object) return c.json({ error: "no_book" }, 404);
    return new Response(object.body, {
      headers: { "Content-Type": EPUB_CONTENT_TYPE, "X-Source-Id": hash },
    });
  });
}
