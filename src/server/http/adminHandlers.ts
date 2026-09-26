import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { BookclubHttp } from "../../shared/http/BookclubHttp.ts";
import { NotFound } from "../../shared/http/errors.ts";
import { backupAll, listBackups, pruneBackups, restoreFrom } from "../backup.ts";
import { CloudflareEnv } from "./cloudflare.ts";
import { io } from "./io.ts";

export const AdminHandlers = HttpApiBuilder.group(BookclubHttp, "admin", (handlers) =>
  handlers
    .handle("backup", () => Effect.flatMap(CloudflareEnv, (env) => io(() => backupAll(env))))
    .handle("backups", () =>
      Effect.flatMap(CloudflareEnv, (env) =>
        Effect.map(
          io(() => listBackups(env)),
          (backups) => ({ backups }),
        ),
      ),
    )
    .handle("prune", () => Effect.flatMap(CloudflareEnv, (env) => io(() => pruneBackups(env))))
    .handle("restore", ({ payload }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const restored = yield* io(() => restoreFrom(env, payload.key));
        return restored ?? (yield* new NotFound({ error: "restore_failed", reason: "no_backup" }));
      }),
    ),
);
