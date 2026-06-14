import type { Hono } from "hono";
import { EPUB_CONTENT_TYPE } from "./books.ts";
import type { Env } from "./env.ts";
import {
  createGroup,
  fetchBook,
  inviteByEmail,
  inviteLink,
  listMyGroups,
  redeemInvite,
  renameBookTitle,
  renameGroupTitle,
  resolveGroupView,
  uploadBook,
  type WorkflowFailure,
} from "./groupWorkflows.ts";
import { readJson } from "./http.ts";

function workflowError(result: WorkflowFailure): Response {
  const body = result.reason
    ? { error: result.error, reason: result.reason }
    : { error: result.error };
  return new Response(JSON.stringify(body), {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
}

// Register all /groups* routes on the app.
export function registerGroupRoutes(app: Hono<{ Bindings: Env }>): void {
  // List the groups the signed-in user belongs to (the home list).
  app.get("/groups", async (c) => {
    const result = await listMyGroups(c.env, c.req.raw);
    return result.ok ? c.json(result.value) : workflowError(result);
  });

  // Create a group with a unique, write-once URL name.
  app.post("/groups", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await createGroup(c.env, c.req.raw, body?.name);
    return result.ok ? c.json(result.value, 201) : workflowError(result);
  });

  // Resolve a group by URL name, with the caller's membership.
  app.get("/groups/:name", async (c) => {
    const result = await resolveGroupView(c.env, c.req.raw, c.req.param("name"));
    return result.ok ? c.json(result.value) : workflowError(result);
  });

  // Owner-only: get (or, with ?rotate=1, regenerate) the group's open invite link.
  app.post("/groups/:name/invite-link", async (c) => {
    const rotate = c.req.query("rotate") === "1";
    const result = await inviteLink(c.env, c.req.raw, c.req.param("name"), rotate);
    return result.ok ? c.json(result.value) : workflowError(result);
  });

  // Any member: rename the club (its display name; the URL name is write-once).
  app.put("/groups/:name/title", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await renameGroupTitle(c.env, c.req.raw, c.req.param("name"), body?.title);
    return result.ok ? c.json(result.value) : workflowError(result);
  });

  // Any member: set a display title for a bound book.
  app.put("/groups/:name/book/title", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await renameBookTitle(
      c.env,
      c.req.raw,
      c.req.param("name"),
      body?.sourceId,
      body?.title,
    );
    return result.ok ? c.json(result.value) : workflowError(result);
  });

  // Owner-only: invite an email to the group; deliver a redeem link.
  app.post("/groups/:name/invite", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await inviteByEmail(c.env, c.req.raw, c.req.param("name"), body?.email);
    return result.ok ? c.body(null, 204) : workflowError(result);
  });

  // Redeem an invite token: the signed-in caller joins the group.
  app.post("/groups/:name/join", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await redeemInvite(c.env, c.req.raw, c.req.param("name"), body?.token);
    return result.ok ? c.json(result.value) : workflowError(result);
  });

  // Owner-only: upload the group's book. Bytes are stored in R2 by content hash
  // (dedup) and the hash is bound to the group as its source (decision 13).
  app.put("/groups/:name/book", async (c) => {
    const result = await uploadBook(c.env, c.req.raw, c.req.param("name"));
    return result.ok ? c.json(result.value) : workflowError(result);
  });

  // Member-only: stream the group's bound book from R2. 404 until the owner has
  // uploaded one.
  app.get("/groups/:name/book", async (c) => {
    const result = await fetchBook(c.env, c.req.raw, c.req.param("name"));
    if (!result.ok) return workflowError(result);
    return new Response(result.value.object.body, {
      headers: { "Content-Type": EPUB_CONTENT_TYPE, "X-Source-Id": result.value.hash },
    });
  });
}
