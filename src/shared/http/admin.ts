import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";

const Forbidden = Schema.Struct({ error: Schema.Literal("forbidden") }).pipe(
  HttpApiSchema.status(403),
);
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
  HttpApiEndpoint.post("backup", "/admin/backup", { success: BackupResult, error: Forbidden }),
  HttpApiEndpoint.get("backups", "/admin/backups", {
    success: Schema.Struct({
      backups: Schema.Array(
        Schema.Struct({ key: Schema.String, size: Schema.Number, uploaded: Schema.String }),
      ),
    }),
    error: Forbidden,
  }),
  HttpApiEndpoint.post("prune", "/admin/prune", {
    success: Schema.Struct({ deleted: Schema.Number, kept: Schema.Number }),
    error: Forbidden,
  }),
  HttpApiEndpoint.post("restore", "/admin/restore", {
    payload: Schema.Struct({ key: Schema.String }),
    success: RestoreResult,
    error: [
      Forbidden,
      Schema.Struct({ error: Schema.Literal("missing_key") }).pipe(HttpApiSchema.status(400)),
      Schema.Struct({ error: Schema.Literal("restore_failed"), reason: Schema.String }).pipe(
        HttpApiSchema.status(404),
      ),
    ],
  }),
);
