import type { Hono } from "hono";
import type { Env } from "../env.ts";
import {
  changeMemberRole,
  createGroup,
  deleteBook,
  deleteGroup,
  deleteImageUpload,
  fetchSource,
  fetchImage,
  exportGroupBackup,
  inviteByEmail,
  inviteLink,
  listGroupImages,
  listMyGroups,
  redeemInvite,
  renameBookTitle,
  renameGroupTitle,
  resolveBookTitle,
  resolveGroupView,
  restoreGroupBackup,
  uploadImage,
  uploadSource,
  updateBookMetadata,
  type WorkflowFailure,
} from "../workflows/groupWorkflows.ts";
import { readJson } from "../http.ts";
import { BOOKCLUB_ARCHIVE_CONTENT_TYPE } from "../../shared/backups/bookclubArchive.ts";

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
    const result = await createGroup(c.env, c.req.raw, body?.displayName);
    return result.ok ? c.json(result.value, 201) : workflowError(result);
  });

  app.get("/groups/:groupId", async (c) => {
    const result = await resolveGroupView(c.env, c.req.raw, c.req.param("groupId"));
    return result.ok ? c.json(result.value) : workflowError(result);
  });

  app.post("/groups/:groupId/invite-link", async (c) => {
    const rotate = c.req.query("rotate") === "1";
    const result = await inviteLink(c.env, c.req.raw, c.req.param("groupId"), rotate);
    return result.ok ? c.json(result.value) : workflowError(result);
  });

  app.put("/groups/:groupId/title", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await renameGroupTitle(c.env, c.req.raw, c.req.param("groupId"), body?.title);
    return result.ok ? c.json(result.value) : workflowError(result);
  });

  app.put("/groups/:groupId/book/title", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await renameBookTitle(
      c.env,
      c.req.raw,
      c.req.param("groupId"),
      body?.sourceId,
      body?.title,
    );
    return result.ok ? c.json(result.value) : workflowError(result);
  });

  app.put("/groups/:groupId/book/parsed-title", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await resolveBookTitle(
      c.env,
      c.req.raw,
      c.req.param("groupId"),
      body?.sourceId,
      body?.title,
    );
    return result.ok ? c.json(result.value) : workflowError(result);
  });

  app.post("/groups/:groupId/invite", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await inviteByEmail(c.env, c.req.raw, c.req.param("groupId"), body?.email);
    return result.ok ? c.body(null, 204) : workflowError(result);
  });

  app.put("/groups/:groupId/members/:memberId/role", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await changeMemberRole(
      c.env,
      c.req.raw,
      c.req.param("groupId"),
      c.req.param("memberId"),
      body?.role,
    );
    return result.ok ? c.json(result.value) : workflowError(result);
  });

  app.post("/groups/:groupId/join", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await redeemInvite(c.env, c.req.raw, c.req.param("groupId"), body?.token);
    return result.ok ? c.json(result.value) : workflowError(result);
  });

  app.put("/groups/:groupId/book", async (c) => {
    const result = await uploadSource(c.env, c.req.raw, c.req.param("groupId"));
    return result.ok ? c.json(result.value) : workflowError(result);
  });

  app.get("/groups/:groupId/book", async (c) => {
    const result = await fetchSource(
      c.env,
      c.req.raw,
      c.req.param("groupId"),
      c.req.query("sourceId") ?? null,
    );
    if (!result.ok) return workflowError(result);
    return new Response(result.value.object.body, {
      headers: { "Content-Type": result.value.contentType, "X-Source-Id": result.value.hash },
    });
  });

  app.delete("/groups/:groupId/book/:sourceId", async (c) => {
    const result = await deleteBook(
      c.env,
      c.req.raw,
      c.req.param("groupId"),
      c.req.param("sourceId"),
    );
    return result.ok ? c.json(result.value) : workflowError(result);
  });

  app.put("/groups/:groupId/book/:sourceId/metadata", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await updateBookMetadata(
      c.env,
      c.req.raw,
      c.req.param("groupId"),
      c.req.param("sourceId"),
      body,
    );
    return result.ok ? c.json(result.value) : workflowError(result);
  });

  app.delete("/groups/:groupId", async (c) => {
    const result = await deleteGroup(c.env, c.req.raw, c.req.param("groupId"));
    return result.ok ? c.body(null, 204) : workflowError(result);
  });

  app.post("/groups/:groupId/images", async (c) => {
    const result = await uploadImage(c.env, c.req.raw, c.req.param("groupId"));
    return result.ok ? c.json(result.value, 201) : workflowError(result);
  });

  app.get("/groups/:groupId/images", async (c) => {
    const result = await listGroupImages(c.env, c.req.raw, c.req.param("groupId"));
    return result.ok ? c.json(result.value) : workflowError(result);
  });

  app.delete("/groups/:groupId/images/:imageId", async (c) => {
    const result = await deleteImageUpload(
      c.env,
      c.req.raw,
      c.req.param("groupId"),
      c.req.param("imageId"),
    );
    return result.ok ? c.body(null, 204) : workflowError(result);
  });

  app.get("/groups/:groupId/images/:imageId", async (c) => {
    const result = await fetchImage(
      c.env,
      c.req.raw,
      c.req.param("groupId"),
      c.req.param("imageId"),
    );
    if (!result.ok) return workflowError(result);
    return new Response(result.value.object.body, {
      headers: {
        "Content-Type": result.value.contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  });

  app.get("/groups/:groupId/backup", async (c) => {
    const result = await exportGroupBackup(c.env, c.req.raw, c.req.param("groupId"));
    if (!result.ok) return workflowError(result);
    return new Response(Uint8Array.from(result.value.bytes).buffer, {
      headers: {
        "Content-Type": BOOKCLUB_ARCHIVE_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${result.value.filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  app.put("/groups/:groupId/backup", async (c) => {
    const result = await restoreGroupBackup(c.env, c.req.raw, c.req.param("groupId"));
    return result.ok ? c.json(result.value) : workflowError(result);
  });
}
