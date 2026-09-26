import { Effect, Layer } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { Forbidden } from "../../shared/http/errors.ts";
import { Administration } from "../../shared/http/middleware.ts";
import { constantTimeEqual } from "../../shared/crypto.ts";
import { requestIdentity } from "./authentication.ts";
import { requestEnv } from "./cloudflare.ts";

// Machines (the pre-deploy backup) present ADMIN_API_TOKEN; a person signs in as ADMIN_EMAIL.
export const AdministrationLive = Layer.succeed(Administration, (effect) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const env = yield* requestEnv;
    const authorization = request.headers.authorization;
    const bearer = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;
    if (env.ADMIN_API_TOKEN && bearer && constantTimeEqual(bearer, env.ADMIN_API_TOKEN)) {
      return yield* effect;
    }
    const identity = yield* requestIdentity;
    if (env.ADMIN_EMAIL && identity?.email === env.ADMIN_EMAIL) return yield* effect;
    return yield* new Forbidden({ error: "forbidden" });
  }),
);
