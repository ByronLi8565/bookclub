import { Layer } from "effect";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import type { Env } from "../env.ts";
import { AccountHandlers, AccountsApi } from "./accountHandlers.ts";
import { AuthenticationLive } from "./authentication.ts";
import { CloudflareRequest } from "./cloudflare.ts";

const decodeErrors: Readonly<Record<string, string>> = {
  "POST /auth/start": "invalid_email",
  "POST /auth/verify": "invalid_request",
  "POST /admin/restore": "missing_key",
};

export const BOOKCLUB_HTTP_PREFIXES = ["/auth", "/me", "/users", "/groups", "/admin"] as const;

const Routes = Layer.mergeAll(
  HttpApiBuilder.layer(AccountsApi).pipe(
    Layer.provide(AccountHandlers),
    Layer.provide(AuthenticationLive),
  ),
  HttpRouter.add("*", "/*", HttpServerResponse.empty({ status: 404 })),
).pipe(Layer.provide(HttpServer.layerServices));

const fallback = HttpRouter.toWebHandler(Routes, { disableLogger: true });

const errorEnvelope = (request: Request, response: Response): Response => {
  if (response.status < 400 || response.body !== null) return response;
  const error =
    response.status === 400
      ? (decodeErrors[`${request.method} ${new URL(request.url).pathname}`] ?? "invalid_request")
      : response.status === 404
        ? "not_found"
        : "internal_error";
  return Response.json({ error }, { status: response.status, headers: response.headers });
};

export const bookclubHttpFallback = {
  handler: async (request: Request, env: Env, _executionContext?: ExecutionContext) =>
    errorEnvelope(
      request,
      await fallback.handler(new CloudflareRequest(request, env, _executionContext)),
    ),
  dispose: fallback.dispose,
};
