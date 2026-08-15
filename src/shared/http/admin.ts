import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { BadRequestError, ForbiddenError, InternalErrorSchema, NotFoundError } from "./errors.ts";
const BackupResult = Schema.Struct({
  key: Schema.String,
  takenAt: Schema.String,
  groups: Schema.Number,
  notes: Schema.Number,
  auth: Schema.Number,
  pruned: Schema.Number,
});
const RestoreResult = Schema.Struct({
  key: Schema.String,
  takenAt: Schema.String,
  groups: Schema.Number,
  notes: Schema.Number,
  auth: Schema.Number,
});

export const AdminHttp = HttpApiGroup.make("admin").add(
  HttpApiEndpoint.post("backup", "/admin/backup", {
    success: BackupResult,
    error: [ForbiddenError, InternalErrorSchema],
  }),
  HttpApiEndpoint.get("backups", "/admin/backups", {
    success: Schema.Struct({
      backups: Schema.Array(
        Schema.Struct({ key: Schema.String, size: Schema.Number, uploaded: Schema.String }),
      ),
    }),
    error: [ForbiddenError, InternalErrorSchema],
  }),
  HttpApiEndpoint.post("prune", "/admin/prune", {
    success: Schema.Struct({ deleted: Schema.Number, kept: Schema.Number }),
    error: [ForbiddenError, InternalErrorSchema],
  }),
  HttpApiEndpoint.post("restore", "/admin/restore", {
    payload: Schema.Struct({ key: Schema.String }),
    success: RestoreResult,
    error: [ForbiddenError, BadRequestError, NotFoundError, InternalErrorSchema],
  }),
);
