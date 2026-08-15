import { Effect } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiGroup } from "effect/unstable/httpapi";
import { AdminHttp } from "../../shared/http/admin.ts";
import { InternalError, NotFound } from "../../shared/http/errors.ts";
import { backupAll, listBackups, pruneBackups, restoreFrom } from "../backup.ts";
import { Administration } from "./administration.ts";
import { CloudflareEnv } from "./cloudflare.ts";

const MigratedAdminHttp = HttpApiGroup.make("migratedAdmin")
  .add(
    AdminHttp.endpoints.backup,
    AdminHttp.endpoints.backups,
    AdminHttp.endpoints.prune,
    AdminHttp.endpoints.restore,
  )
  .middleware(Administration);

export const AdminApi = HttpApi.make("bookclub-admin").add(MigratedAdminHttp);

const adminIo = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: () => new InternalError({ error: "internal_error" }) });

export const AdminHandlers = HttpApiBuilder.group(AdminApi, "migratedAdmin", (handlers) =>
  handlers
    .handle("backup", () => Effect.flatMap(CloudflareEnv, (env) => adminIo(() => backupAll(env))))
    .handle("backups", () =>
      Effect.flatMap(CloudflareEnv, (env) =>
        Effect.map(
          adminIo(() => listBackups(env)),
          (backups) => ({ backups }),
        ),
      ),
    )
    .handle("prune", () => Effect.flatMap(CloudflareEnv, (env) => adminIo(() => pruneBackups(env))))
    .handle("restore", ({ payload }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        return yield* Effect.tryPromise({
          try: () => restoreFrom(env, payload.key),
          catch: (error) => new NotFound({ error: "restore_failed", reason: String(error) }),
        });
      }),
    ),
);
