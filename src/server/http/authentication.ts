import { Context, Effect, Layer } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { HttpApiMiddleware } from "effect/unstable/httpapi";
import {
  InternalError,
  InternalErrorSchema,
  Unauthenticated,
  UnauthenticatedError,
} from "../../shared/http/errors.ts";
import type { Identity } from "../state/GroupAgent.ts";
import type { Env } from "../env.ts";
import { currentIdentity } from "../auth/cookies.ts";
import { CloudflareEnv } from "./cloudflare.ts";
import { CloudflareRequest } from "./cloudflare.ts";

export class CurrentIdentity extends Context.Service<CurrentIdentity, Identity>()(
  "bookclub/http/CurrentIdentity",
) {}

export class Authentication extends HttpApiMiddleware.Service<
  Authentication,
  { provides: CurrentIdentity | CloudflareEnv }
>()("bookclub/http/Authentication", { error: [UnauthenticatedError, InternalErrorSchema] }) {}

const withoutQuerySession = (request: Request): Request => {
  const url = new URL(request.url);
  url.searchParams.delete("token");
  return url.href === request.url ? request : new Request(url, request);
};

export const currentStructuredIdentity = (request: Request, env: Env) =>
  currentIdentity(withoutQuerySession(request), env);

export const AuthenticationLive = Layer.succeed(Authentication, (effect) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const source = request.source;
    if (!(source instanceof CloudflareRequest)) {
      return yield* new InternalError({ error: "internal_error" });
    }
    const env = source.env;
    const identity = yield* Effect.tryPromise({
      try: () => currentStructuredIdentity(source, env),
      catch: () => new InternalError({ error: "internal_error" }),
    });
    if (identity === null) {
      return yield* new Unauthenticated({ error: "unauthenticated" });
    }
    return yield* effect.pipe(
      Effect.provideService(CloudflareEnv, env),
      Effect.provideService(CurrentIdentity, identity),
    );
  }),
);
