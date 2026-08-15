import { Effect } from "effect";
import type { Env } from "./env.ts";
import { backupAll } from "./backup.ts";
import { bookclubHttpFallback } from "./http/live.ts";

export { NoteAgent } from "./state/NoteAgent.ts";
export { AuthAgent } from "./state/AuthAgent.ts";
export { GroupAgent } from "./state/GroupAgent.ts";
export { GroupRegistry } from "./state/GroupRegistry.ts";

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> =>
    bookclubHttpFallback.handler(request, env, ctx),
  scheduled: (_controller: ScheduledController, env: Env, ctx: ExecutionContext): void => {
    ctx.waitUntil(
      Effect.runPromise(
        Effect.tryPromise(() => backupAll(env)).pipe(
          Effect.tap((result) => Effect.sync(() => console.log("scheduled backup ok", result))),
          Effect.tapError((error) =>
            Effect.sync(() => console.error("scheduled backup failed", error)),
          ),
        ),
      ),
    );
  },
};
