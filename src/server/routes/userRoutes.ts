import type { Hono } from "hono";
import type { Env } from "../env.ts";
import { readJson } from "../util/http.ts";
import {
  getReadingPosition,
  getUserPrefs,
  setReadingPosition,
  setUserPrefs,
  type WorkflowFailure,
} from "../workflows/userWorkflows.ts";

function workflowError(result: WorkflowFailure): Response {
  return new Response(JSON.stringify({ error: result.error }), {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
}

export function registerUserRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get("/me/prefs", async (c) => {
    const result = await getUserPrefs(c.env, c.req.raw);
    return result.ok ? c.json(result.value) : workflowError(result);
  });

  app.put("/me/prefs", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await setUserPrefs(c.env, c.req.raw, body);
    return result.ok ? c.json(result.value) : workflowError(result);
  });

  app.get("/me/reading-position", async (c) => {
    const result = await getReadingPosition(
      c.env,
      c.req.raw,
      c.req.query("groupId") ?? null,
      c.req.query("sourceId") ?? null,
    );
    return result.ok ? c.json(result.value) : workflowError(result);
  });

  app.put("/me/reading-position", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await setReadingPosition(c.env, c.req.raw, body);
    return result.ok ? c.json(result.value) : workflowError(result);
  });
}
