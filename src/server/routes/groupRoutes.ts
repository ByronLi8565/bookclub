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
} from "../workflows/groupWorkflows.ts";
import { readJson, workflowResponse } from "../http.ts";
import { BOOKCLUB_ARCHIVE_CONTENT_TYPE } from "../../shared/backups/bookclubArchive.ts";

export function registerGroupRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get("/groups", async (c) => {
    const result = await listMyGroups(c.env, c.req.raw);
    return workflowResponse(result, (value) => c.json(value));
  });

  app.post("/groups", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await createGroup(c.env, c.req.raw, body?.displayName);
    return workflowResponse(result, (value) => c.json(value, 201));
  });

  app.get("/groups/:groupId", async (c) => {
    const result = await resolveGroupView(c.env, c.req.raw, c.req.param("groupId"));
    return workflowResponse(result, (value) => c.json(value));
  });

  app.post("/groups/:groupId/invite-link", async (c) => {
    const rotate = c.req.query("rotate") === "1";
    const result = await inviteLink(c.env, c.req.raw, c.req.param("groupId"), rotate);
    return workflowResponse(result, (value) => c.json(value));
  });

  app.put("/groups/:groupId/title", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await renameGroupTitle(c.env, c.req.raw, c.req.param("groupId"), body?.title);
    return workflowResponse(result, (value) => c.json(value));
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
    return workflowResponse(result, (value) => c.json(value));
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
    return workflowResponse(result, (value) => c.json(value));
  });

  app.post("/groups/:groupId/invite", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await inviteByEmail(c.env, c.req.raw, c.req.param("groupId"), body?.email);
    return workflowResponse(result, () => c.body(null, 204));
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
    return workflowResponse(result, (value) => c.json(value));
  });

  app.post("/groups/:groupId/join", async (c) => {
    const body = await readJson(c.req.raw);
    const result = await redeemInvite(c.env, c.req.raw, c.req.param("groupId"), body?.token);
    return workflowResponse(result, (value) => c.json(value));
  });

  app.put("/groups/:groupId/book", async (c) => {
    const result = await uploadSource(c.env, c.req.raw, c.req.param("groupId"));
    return workflowResponse(result, (value) => c.json(value));
  });

  app.get("/groups/:groupId/book", async (c) => {
    const result = await fetchSource(
      c.env,
      c.req.raw,
      c.req.param("groupId"),
      c.req.query("sourceId") ?? null,
    );
    return workflowResponse(
      result,
      (value) =>
        new Response(value.object.body, {
          headers: { "Content-Type": value.contentType, "X-Source-Id": value.hash },
        }),
    );
  });

  app.delete("/groups/:groupId/book/:sourceId", async (c) => {
    const result = await deleteBook(
      c.env,
      c.req.raw,
      c.req.param("groupId"),
      c.req.param("sourceId"),
    );
    return workflowResponse(result, (value) => c.json(value));
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
    return workflowResponse(result, (value) => c.json(value));
  });

  app.delete("/groups/:groupId", async (c) => {
    const result = await deleteGroup(c.env, c.req.raw, c.req.param("groupId"));
    return workflowResponse(result, () => c.body(null, 204));
  });

  app.post("/groups/:groupId/images", async (c) => {
    const result = await uploadImage(c.env, c.req.raw, c.req.param("groupId"));
    return workflowResponse(result, (value) => c.json(value, 201));
  });

  app.get("/groups/:groupId/images", async (c) => {
    const result = await listGroupImages(c.env, c.req.raw, c.req.param("groupId"));
    return workflowResponse(result, (value) => c.json(value));
  });

  app.delete("/groups/:groupId/images/:imageId", async (c) => {
    const result = await deleteImageUpload(
      c.env,
      c.req.raw,
      c.req.param("groupId"),
      c.req.param("imageId"),
    );
    return workflowResponse(result, () => c.body(null, 204));
  });

  app.get("/groups/:groupId/images/:imageId", async (c) => {
    const result = await fetchImage(
      c.env,
      c.req.raw,
      c.req.param("groupId"),
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

  app.get("/groups/:groupId/backup", async (c) => {
    const result = await exportGroupBackup(c.env, c.req.raw, c.req.param("groupId"));
    return workflowResponse(
      result,
      (value) =>
        new Response(Uint8Array.from(value.bytes).buffer, {
          headers: {
            "Content-Type": BOOKCLUB_ARCHIVE_CONTENT_TYPE,
            "Content-Disposition": `attachment; filename="${value.filename}"`,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        }),
    );
  });

  app.put("/groups/:groupId/backup", async (c) => {
    const result = await restoreGroupBackup(c.env, c.req.raw, c.req.param("groupId"));
    return workflowResponse(result, (value) => c.json(value));
  });
}
