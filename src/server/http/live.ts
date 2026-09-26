import { Effect, Context, Layer } from "effect";
import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { routeAgentRequest } from "agents";
import type { Env } from "../env.ts";
import { BookclubHttp } from "../../shared/http/BookclubHttp.ts";
import { socketIdentity } from "../auth/cookies.ts";
import { AccountHandlers } from "./accountHandlers.ts";
import { AdminHandlers } from "./adminHandlers.ts";
import { AdministrationLive } from "./administration.ts";
import { AuthHandlers } from "./authHandlers.ts";
import { AuthenticationLive } from "./authentication.ts";
import { CloudflareEnv } from "./cloudflare.ts";
import { GroupHandlers } from "./groupHandlers.ts";
import { groupAgent, io } from "./io.ts";
import { FieldFailuresLayer } from "./fieldFailures.ts";
import { NativeCorsLayer } from "./nativeCors.ts";

const API_PREFIXES = ["/auth", "/me", "/users", "/groups", "/admin"] as const;

const webRequest = Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
  HttpServerRequest.toWeb(request),
);

const noteGate = Effect.gen(function* () {
  const request = yield* webRequest;
  const env = yield* CloudflareEnv;
  const me = yield* io(() => socketIdentity(request, env));
  if (!me) return HttpServerResponse.text("unauthenticated", { status: 401 });
  const { groupId } = yield* HttpRouter.params;
  if (!groupId) return HttpServerResponse.text("not found", { status: 404 });
  const group = yield* groupAgent(groupId);
  const { isMember } = yield* io(() => group.membership(me.id));
  if (!isMember) return HttpServerResponse.text("forbidden", { status: 403 });
  const response = yield* io(() => routeAgentRequest(request, env));
  return response
    ? HttpServerResponse.raw(response)
    : HttpServerResponse.text("not found", { status: 404 });
}).pipe(Effect.catch(() => Effect.succeed(HttpServerResponse.text("error", { status: 500 }))));

const fallbackRoute = Effect.gen(function* () {
  const request = yield* webRequest;
  const env = yield* CloudflareEnv;
  const pathname = new URL(request.url).pathname;
  if (API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return HttpServerResponse.jsonUnsafe({ error: "not_found" }, { status: 404 });
  }
  const assets = env.ASSETS;
  if (!assets) {
    return HttpServerResponse.text("Run the client via the vite dev server (bun run dev).", {
      status: 404,
    });
  }
  const assetResponse = yield* io(() => assets.fetch(request));
  // A missing hashed asset must not fall through to the SPA shell as HTML.
  if (
    pathname.startsWith("/assets/") &&
    assetResponse.headers.get("content-type")?.includes("text/html")
  ) {
    return HttpServerResponse.text("not found", { status: 404 });
  }
  return HttpServerResponse.raw(assetResponse);
}).pipe(Effect.catch(() => Effect.succeed(HttpServerResponse.text("error", { status: 500 }))));

const decodeError = (method: string, path: string): string => {
  if (method === "POST" && path === "/auth/start") return "invalid_email";
  if (method === "POST" && path === "/admin/restore") return "missing_key";
  return "invalid_request";
};

const Routes = Layer.mergeAll(
  HttpApiBuilder.layer(BookclubHttp).pipe(
    Layer.provide([AuthHandlers, AccountHandlers, GroupHandlers, AdminHandlers]),
    Layer.provide([AuthenticationLive, AdministrationLive]),
  ),
  HttpRouter.add("*", "/agents/note-agent/:groupId/*", noteGate),
  HttpRouter.add("*", "/*", fallbackRoute),
).pipe(
  Layer.provide(HttpServer.layerServices),
  Layer.provide(NativeCorsLayer),
  Layer.provide(FieldFailuresLayer),
);

const fallback = HttpRouter.toWebHandler(Routes, { disableLogger: true });

const errorEnvelope = async (request: Request, response: Response): Promise<Response> => {
  if (response.status >= 400 && response.body !== null) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    if (typeof body === "object" && body !== null && "error" in body) {
      const { error } = body;
      const reason = "reason" in body ? body.reason : undefined;
      // `_tag` lets the generated client decode the typed failure; `error` is what
      // the native app reads. Nothing else a handler put in the body goes out.
      const tag = "_tag" in body && typeof body._tag === "string" ? { _tag: body._tag } : {};
      if (typeof error === "string") {
        return Response.json(
          typeof reason === "string" ? { ...tag, error, reason } : { ...tag, error },
          { status: response.status, headers: response.headers },
        );
      }
    }
    return response;
  }
  if (response.status < 400) return response;
  const error =
    response.status === 400
      ? decodeError(request.method, new URL(request.url).pathname)
      : response.status === 404
        ? "not_found"
        : "internal_error";
  return Response.json({ error }, { status: response.status, headers: response.headers });
};

export const bookclubHttpFallback = {
  handler: async (request: Request, env: Env) =>
    await errorEnvelope(request, await fallback.handler(request, Context.make(CloudflareEnv, env))),
  dispose: fallback.dispose,
};
