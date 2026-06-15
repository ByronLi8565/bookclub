import type { Hono } from "hono";
import type { Env } from "../env.ts";
import {
  createGroup,
  fetchSource,
  inviteByEmail,
  inviteLink,
  listMyGroups,
  redeemInvite,
  renameBookTitle,
  renameGroupTitle,
  resolveBookTitle,
  resolveGroupView,
  uploadSource,
  type WorkflowFailure,
} from "../workflows/groupWorkflows.ts";
import { readJson } from "../util/http.ts";

function workflowError(result: WorkflowFailure): Response {
  const body = result.reason
    ? { error: result.error, reason: result.reason }
    : { error: result.error };
  return new Response(JSON.stringify(body), {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
}

export function registerGroupRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get("/groups", async (c) => {
    const result = await listMyGroups(c.env, c.req.raw);
    return result.ok ? c.json(result.value) : workflowError(result);
  });

    app.post("/groups", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await createGroup(c.env, c.req.raw, body?.name);
    return result.ok ? c.json(result.value, 201) : workflowError(result);
  });

    app.get("/groups/:name", async (c) => {
    const result = await resolveGroupView(c.env, c.req.raw, c.req.param("name"));
    return result.ok ? c.json(result.value) : workflowError(result);
  });

    app.post("/groups/:name/invite-link", async (c) => {
    const rotate = c.req.query("rotate") === "1";
    const result = await inviteLink(c.env, c.req.raw, c.req.param("name"), rotate);
    return result.ok ? c.json(result.value) : workflowError(result);
  });

    app.put("/groups/:name/title", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await renameGroupTitle(c.env, c.req.raw, c.req.param("name"), body?.title);
    return result.ok ? c.json(result.value) : workflowError(result);
  });

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

      app.put("/groups/:name/book/parsed-title", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await resolveBookTitle(
      c.env,
      c.req.raw,
      c.req.param("name"),
      body?.sourceId,
      body?.title,
    );
    return result.ok ? c.json(result.value) : workflowError(result);
  });

    app.post("/groups/:name/invite", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await inviteByEmail(c.env, c.req.raw, c.req.param("name"), body?.email);
    return result.ok ? c.body(null, 204) : workflowError(result);
  });

    app.post("/groups/:name/join", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await redeemInvite(c.env, c.req.raw, c.req.param("name"), body?.token);
    return result.ok ? c.json(result.value) : workflowError(result);
  });

      app.put("/groups/:name/book", async (c) => {
    const result = await uploadSource(c.env, c.req.raw, c.req.param("name"));
    return result.ok ? c.json(result.value) : workflowError(result);
  });

        app.get("/groups/:name/book", async (c) => {
    const result = await fetchSource(
      c.env,
      c.req.raw,
      c.req.param("name"),
      c.req.query("sourceId") ?? null,
    );
    if (!result.ok) return workflowError(result);
    return new Response(result.value.object.body, {
      headers: { "Content-Type": result.value.contentType, "X-Source-Id": result.value.hash },
    });
  });
}
