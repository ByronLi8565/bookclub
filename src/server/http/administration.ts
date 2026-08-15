import { Effect, Layer } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { HttpApiMiddleware } from "effect/unstable/httpapi";
import {
  Forbidden,
  ForbiddenError,
  InternalError,
  InternalErrorSchema,
} from "../../shared/http/errors.ts";
import { constantTimeEqual } from "../../shared/crypto.ts";
import { CloudflareEnv, CloudflareRequest } from "./cloudflare.ts";
import { currentStructuredIdentity } from "./authentication.ts";

export class Administration extends HttpApiMiddleware.Service<
  Administration,
  { provides: CloudflareEnv }
>()("bookclub/http/Administration", { error: [ForbiddenError, InternalErrorSchema] }) {}

export const AdministrationLive = Layer.succeed(Administration, (effect) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const source = request.source;
    if (!(source instanceof CloudflareRequest)) {
      return yield* new InternalError({ error: "internal_error" });
    }
    const env = source.env;
    const authorization = request.headers.authorization;
    const bearer = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;
    if (env.ADMIN_API_TOKEN && bearer && constantTimeEqual(bearer, env.ADMIN_API_TOKEN)) {
      return yield* Effect.provideService(effect, CloudflareEnv, env);
    }

    const identity = yield* Effect.tryPromise({
      try: () => currentStructuredIdentity(request.source as Request, env),
      catch: () => new InternalError({ error: "internal_error" }),
    });
    if (env.ADMIN_EMAIL && identity?.email === env.ADMIN_EMAIL) {
      return yield* Effect.provideService(effect, CloudflareEnv, env);
    }
    return yield* new Forbidden({ error: "forbidden" });
  }),
);
