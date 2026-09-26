import { Context, Effect, Option } from "effect";
import type { Env } from "../env.ts";

/** The Worker's bindings, supplied per request so no runtime captures one request's `Env`. */
export class CloudflareEnv extends Context.Service<CloudflareEnv, Env>()(
  "bookclub/http/CloudflareEnv",
) {}

/** Middleware may only declare services the router provides, yet it runs under the
 *  per-request context that carries the bindings, so it reads them from there. */
export const requestEnv = Effect.flatMap(
  Effect.serviceOption(CloudflareEnv),
  Option.match({
    onNone: () => Effect.die(new Error("the request context carries no CloudflareEnv")),
    onSome: Effect.succeed,
  }),
);
