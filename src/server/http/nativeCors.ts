import { Effect } from "effect";
import { HttpBody, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

// Native clients authenticate with a bearer token from distinct webview origins, so no credentials.
const NATIVE_ORIGINS = new Set(["capacitor://localhost", "https://localhost", "http://localhost"]);

const PREFLIGHT_POLICY_HEADERS = {
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type",
  "access-control-max-age": "86400",
};

export const isNativeOrigin = (origin: string | undefined): origin is string =>
  origin !== undefined && NATIVE_ORIGINS.has(origin);

export const nativePreflightResponse = (origin: string): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.empty({
    status: 204,
    headers: { "access-control-allow-origin": origin, ...PREFLIGHT_POLICY_HEADERS, vary: "Origin" },
  });

// A raw response wrapping a workerd WebSocket reports outer status 200 even though workerd sends
// 101, so the inner Response must be inspected before any header is touched: upgrade headers are
// immutable and mutating them breaks the native NoteAgent socket.
export const isWebSocketUpgrade = (response: HttpServerResponse.HttpServerResponse): boolean => {
  if (response.status === 101) return true;
  if (!(response.body instanceof HttpBody.Raw)) return false;
  const inner = response.body.body;
  return inner instanceof Response && Boolean(inner.webSocket);
};

export const withNativeCorsHeaders = (
  response: HttpServerResponse.HttpServerResponse,
  origin: string,
): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.setHeaders(response, {
    "access-control-allow-origin": origin,
    vary: response.headers.vary ? `${response.headers.vary}, Origin` : "Origin",
  });

export const nativeCors = <E, R>(
  httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  E,
  R | HttpServerRequest.HttpServerRequest
> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const origin = request.headers.origin;
    if (!isNativeOrigin(origin)) return yield* httpEffect;
    // Unlike HttpRouter.cors, a disallowed origin's OPTIONS falls through to the router.
    if (request.method === "OPTIONS") return nativePreflightResponse(origin);

    const response = yield* httpEffect;
    return isWebSocketUpgrade(response) ? response : withNativeCorsHeaders(response, origin);
  });

export const NativeCorsLayer = HttpRouter.middleware(nativeCors, { global: true });
