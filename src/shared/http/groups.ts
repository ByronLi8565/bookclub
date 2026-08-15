import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";
import {
  BookMetadataPatchSchema,
  GroupRoleSchema,
  GroupSummary,
  Membership,
  RosterEntry,
} from "../types/groups.ts";
import { Created, StreamBytes } from "./compatibility.ts";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalErrorSchema,
  NotFoundError,
  ServiceUnavailableError,
  TooLargeError,
  UnauthenticatedError,
} from "./errors.ts";

const Group = Schema.Struct({ group: GroupSummary });
const GroupRef = { groupRef: Schema.String };
const GroupErrors = [
  UnauthenticatedError,
  NotFoundError,
  ForbiddenError,
  InternalErrorSchema,
] as const;
const Image = Schema.Struct({ id: Schema.String, contentType: Schema.String, size: Schema.Number });
const GroupImage = Schema.Struct({
  id: Schema.String,
  size: Schema.Number,
  contentType: Schema.String,
  uploadedAt: Schema.String,
  uploadedBy: Schema.NullOr(Schema.String),
  uploaderName: Schema.String,
});

export const GroupsHttp = HttpApiGroup.make("groups").add(
  HttpApiEndpoint.get("list", "/groups", {
    success: Schema.Struct({ groups: Schema.Array(GroupSummary) }),
    error: [UnauthenticatedError, InternalErrorSchema],
  }),
  HttpApiEndpoint.post("create", "/groups", {
    payload: Schema.Struct({ displayName: Schema.String }),
    success: Group.pipe(HttpApiSchema.status(201)),
    error: [
      BadRequestError,
      UnauthenticatedError,
      ConflictError,
      InternalErrorSchema,
      ServiceUnavailableError,
    ],
  }),
  HttpApiEndpoint.get("get", "/groups/:groupRef", {
    params: GroupRef,
    success: Schema.Struct({
      group: GroupSummary,
      membership: Membership,
      members: Schema.Array(RosterEntry),
    }),
    error: GroupErrors,
  }),
  HttpApiEndpoint.post("inviteLink", "/groups/:groupRef/invite-link", {
    params: GroupRef,
    query: { rotate: Schema.optionalKey(Schema.String) },
    success: Schema.Struct({ token: Schema.String, link: Schema.String }),
    error: GroupErrors,
  }),
  HttpApiEndpoint.put("rename", "/groups/:groupRef/title", {
    params: GroupRef,
    payload: Schema.Struct({ title: Schema.String }),
    success: Group,
    error: [BadRequestError, ...GroupErrors],
  }),
  HttpApiEndpoint.put("renameBook", "/groups/:groupRef/book/title", {
    params: GroupRef,
    payload: Schema.Struct({ sourceId: Schema.String, title: Schema.String }),
    success: Group,
    error: [BadRequestError, ...GroupErrors],
  }),
  HttpApiEndpoint.put("resolveBookTitle", "/groups/:groupRef/book/parsed-title", {
    params: GroupRef,
    payload: Schema.Struct({ sourceId: Schema.String, title: Schema.String }),
    success: Group,
    error: [BadRequestError, ...GroupErrors],
  }),
  HttpApiEndpoint.post("invite", "/groups/:groupRef/invite", {
    params: GroupRef,
    payload: Schema.Struct({ email: Schema.String }),
    error: [BadRequestError, ...GroupErrors],
  }),
  HttpApiEndpoint.put("setMemberRole", "/groups/:groupRef/members/:memberId/role", {
    params: { ...GroupRef, memberId: Schema.String },
    payload: Schema.Struct({ role: GroupRoleSchema }),
    success: Schema.Struct({ members: Schema.Array(RosterEntry) }),
    error: [BadRequestError, ...GroupErrors],
  }),
  HttpApiEndpoint.post("join", "/groups/:groupRef/join", {
    params: GroupRef,
    payload: Schema.Struct({ token: Schema.String }),
    success: Group,
    error: [BadRequestError, ...GroupErrors],
  }),
  HttpApiEndpoint.put("uploadBook", "/groups/:groupRef/book", {
    params: GroupRef,
    headers: {
      "content-type": Schema.optionalKey(Schema.String),
      "x-source-title": Schema.optionalKey(Schema.String),
      "x-source-author": Schema.optionalKey(Schema.String),
      "x-source-word-count": Schema.optionalKey(Schema.String),
    },
    success: Schema.Struct({ hash: Schema.String }),
    error: [BadRequestError, ...GroupErrors],
  }),
  HttpApiEndpoint.get("book", "/groups/:groupRef/book", {
    params: GroupRef,
    query: { sourceId: Schema.optionalKey(Schema.String) },
    success: StreamBytes,
    error: GroupErrors,
  }),
  HttpApiEndpoint.delete("deleteBook", "/groups/:groupRef/book/:sourceId", {
    params: { ...GroupRef, sourceId: Schema.String },
    success: Group,
    error: GroupErrors,
  }),
  HttpApiEndpoint.put("updateBookMetadata", "/groups/:groupRef/book/:sourceId/metadata", {
    params: { ...GroupRef, sourceId: Schema.String },
    payload: BookMetadataPatchSchema,
    success: Group,
    error: [BadRequestError, ...GroupErrors],
  }),
  HttpApiEndpoint.delete("delete", "/groups/:groupRef", { params: GroupRef, error: GroupErrors }),
  HttpApiEndpoint.post("uploadImage", "/groups/:groupRef/images", {
    params: GroupRef,
    headers: { "content-type": Schema.optionalKey(Schema.String) },
    success: Created(Image),
    error: [BadRequestError, TooLargeError, ...GroupErrors],
  }),
  HttpApiEndpoint.get("images", "/groups/:groupRef/images", {
    params: GroupRef,
    success: Schema.Struct({ images: Schema.Array(GroupImage), totalSize: Schema.Number }),
    error: GroupErrors,
  }),
  HttpApiEndpoint.delete("deleteImage", "/groups/:groupRef/images/:imageId", {
    params: { ...GroupRef, imageId: Schema.String },
    error: [ConflictError, ...GroupErrors],
  }),
  HttpApiEndpoint.get("image", "/groups/:groupRef/images/:imageId", {
    params: { ...GroupRef, imageId: Schema.String },
    success: StreamBytes,
    error: GroupErrors,
  }),
  HttpApiEndpoint.get("exportBackup", "/groups/:groupRef/backup", {
    params: GroupRef,
    success: StreamBytes,
    error: [TooLargeError, ...GroupErrors],
  }),
  HttpApiEndpoint.put("restoreBackup", "/groups/:groupRef/backup", {
    params: GroupRef,
    success: Schema.Struct({
      notes: Schema.Number,
      images: Schema.Number,
      createdAt: Schema.String,
    }),
    error: [BadRequestError, ConflictError, TooLargeError, ...GroupErrors],
  }),
);
