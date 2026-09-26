import { Effect, Layer } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { Unauthenticated } from "../../shared/http/errors.ts";
import { Authentication, CurrentIdentity } from "../../shared/http/middleware.ts";
import { currentIdentity } from "../auth/cookies.ts";
import { requestEnv } from "./cloudflare.ts";
import { io } from "./io.ts";

export const requestIdentity = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const env = yield* requestEnv;
  const { cookie, authorization } = request.headers;
  return yield* io(() => currentIdentity({ cookie, authorization }, env));
});

export const AuthenticationLive = Layer.succeed(Authentication, (effect) =>
  Effect.gen(function* () {
    const identity = yield* requestIdentity;
    if (identity === null) return yield* new Unauthenticated({ error: "unauthenticated" });
    return yield* Effect.provideService(effect, CurrentIdentity, identity);
  }),
);
