import type { Hono } from "hono";
import type { Env } from "../env.ts";
import { readJson, workflowResponse } from "../http.ts";
import {
  fetchAvatar,
  getReadingPosition,
  getUserPrefs,
  setReadingPosition,
  setClubProfile,
  setUserPrefs,
  uploadAvatar,
} from "../workflows/userWorkflows.ts";

export function registerUserRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get("/me/prefs", async (c) => {
    const result = await getUserPrefs(c.env, c.req.raw);
    return workflowResponse(result, (value) => c.json(value));
  });

  app.put("/me/prefs", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await setUserPrefs(c.env, c.req.raw, body);
    return workflowResponse(result, (value) => c.json(value));
  });

  app.get("/me/reading-position", async (c) => {
    const result = await getReadingPosition(
      c.env,
      c.req.raw,
      c.req.query("groupId") ?? null,
      c.req.query("sourceId") ?? null,
    );
    return workflowResponse(result, (value) => c.json(value));
  });

  app.put("/me/reading-position", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await setReadingPosition(c.env, c.req.raw, body);
    return workflowResponse(result, (value) => c.json(value));
  });

  app.put("/me/avatar", async (c) => {
    const result = await uploadAvatar(c.env, c.req.raw);
    return workflowResponse(result, (value) => c.json(value, 201));
  });

  app.put("/me/clubs/:groupId/profile", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await setClubProfile(
      c.env,
      c.req.raw,
      c.req.param("groupId"),
      body?.displayName,
    );
    return workflowResponse(result, (value) => c.json(value));
  });

  app.get("/users/:userId/avatar/:imageId", async (c) => {
    const result = await fetchAvatar(
      c.env,
      c.req.raw,
      c.req.param("userId"),
      c.req.param("imageId"),
    );
    return workflowResponse(
      result,
      (value) =>
        new Response(value.object.body, {
          headers: { "Content-Type": value.contentType, "Cache-Control": "private, max-age=3600" },
        }),
    );
  });
}
