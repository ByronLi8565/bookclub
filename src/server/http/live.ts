import { Effect, Context, Layer } from "effect";
import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { getAgentByName, routeAgentRequest } from "agents";
import type { Env } from "../env.ts";
import { currentIdentity } from "../auth/cookies.ts";
import { AccountHandlers, AccountsApi } from "./accountHandlers.ts";
import { AdminApi, AdminHandlers } from "./adminHandlers.ts";
import { AdministrationLive } from "./administration.ts";
import { AuthApi, AuthHandlers } from "./authHandlers.ts";
import { AuthenticationLive } from "./authentication.ts";
import { CloudflareEnv, CloudflareRequest } from "./cloudflare.ts";
import { GroupHandlers, GroupsApi } from "./groupHandlers.ts";
import { GroupDataApi, GroupDataHandlers } from "./groupDataHandlers.ts";
import { NativeCorsLayer } from "./nativeCors.ts";

const rawResponse = (response: Response) => HttpServerResponse.raw(response);
const platformIo = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  });

const noteGate = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const source = request.source;
  if (!(source instanceof CloudflareRequest))
    return HttpServerResponse.text("not found", { status: 404 });
  const me = yield* platformIo(() => currentIdentity(source, source.env));
  if (!me) return HttpServerResponse.text("unauthenticated", { status: 401 });
  const params = yield* HttpRouter.params;
  const groupId = params.groupId;
  if (!groupId) return HttpServerResponse.text("not found", { status: 404 });
  const group = yield* platformIo(() => getAgentByName(source.env.GroupAgent, groupId));
  const membership = yield* platformIo(() => group.membership(me.id));
  if (!membership.isMember) return HttpServerResponse.text("forbidden", { status: 403 });
  const response = yield* platformIo(() => routeAgentRequest(source, source.env));
  return response ? rawResponse(response) : HttpServerResponse.text("not found", { status: 404 });
});

const fallbackRoute = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const source = request.source;
  if (!(source instanceof CloudflareRequest))
    return HttpServerResponse.text("not found", { status: 404 });
  const pathname = new URL(source.url).pathname;
  if (
    BOOKCLUB_HTTP_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  ) {
    return HttpServerResponse.jsonUnsafe({ error: "not_found" }, { status: 404 });
  }
  const agentResponse = yield* platformIo(() => routeAgentRequest(source, source.env));
  if (agentResponse) return rawResponse(agentResponse);
  const assets = source.env.ASSETS;
  if (!assets) {
    return HttpServerResponse.text("Run the client via the vite dev server (npm run dev).", {
      status: 404,
    });
  }
  const assetResponse = yield* platformIo(() => assets.fetch(source));
  if (
    pathname.startsWith("/assets/") &&
    assetResponse.headers.get("content-type")?.includes("text/html")
  ) {
    return HttpServerResponse.text("not found", { status: 404 });
  }
  return rawResponse(assetResponse);
});

const decodeError = (method: string, path: string): string => {
  if (method === "POST" && path === "/auth/start") return "invalid_email";
  if (method === "POST" && path === "/admin/restore") return "missing_key";
  return "invalid_request";
};

export const BOOKCLUB_HTTP_PREFIXES = ["/auth", "/me", "/users", "/groups", "/admin"] as const;

const Routes = Layer.mergeAll(
  HttpApiBuilder.layer(AdminApi).pipe(
    Layer.provide(AdminHandlers),
    Layer.provide(AdministrationLive),
  ),
  HttpApiBuilder.layer(AccountsApi).pipe(
    Layer.provide(AccountHandlers),
    Layer.provide(AuthenticationLive),
  ),
  HttpApiBuilder.layer(AuthApi).pipe(
    Layer.provide(AuthHandlers),
    Layer.provide(AuthenticationLive),
  ),
  HttpApiBuilder.layer(GroupsApi).pipe(
    Layer.provide(GroupHandlers),
    Layer.provide(AuthenticationLive),
  ),
  HttpApiBuilder.layer(GroupDataApi).pipe(
    Layer.provide(GroupDataHandlers),
    Layer.provide(AuthenticationLive),
  ),
  HttpRouter.add("*", "/agents/note-agent/:groupId/*", noteGate),
  HttpRouter.add("*", "/*", fallbackRoute),
).pipe(Layer.provide(HttpServer.layerServices), Layer.provide(NativeCorsLayer));

const fallback = HttpRouter.toWebHandler(Routes, { disableLogger: true });

const errorEnvelope = async (request: Request, response: Response): Promise<Response> => {
  if (response.status >= 400 && response.body !== null) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    if (typeof body === "object" && body !== null && "error" in body) {
      const error = body.error;
      const reason = "reason" in body ? body.reason : undefined;
      if (typeof error === "string") {
        return Response.json(typeof reason === "string" ? { error, reason } : { error }, {
          status: response.status,
          headers: response.headers,
        });
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
  handler: async (request: Request, env: Env, _executionContext?: ExecutionContext) =>
    await errorEnvelope(
      request,
      await fallback.handler(
        new CloudflareRequest(request, env, _executionContext),
        Context.make(CloudflareEnv, env),
      ),
    ),
  dispose: fallback.dispose,
};
