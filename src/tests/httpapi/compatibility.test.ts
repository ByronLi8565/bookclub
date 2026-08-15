import { Context, Effect, Layer, Schema, Stream } from "effect";
import { Hono } from "hono";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";
import {
  HttpBody,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { afterAll, describe, expect, it } from "vitest";

class RequestId extends Context.Service<RequestId, string>()("bookclub/test/RequestId") {}

const Echo = Schema.Struct({ requestId: Schema.String, value: Schema.String });
const Started = Schema.Struct({ requestId: Schema.String }).pipe(HttpApiSchema.status(200));
const Download = HttpApiSchema.WithHeaders(
  Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array({ contentType: "application/octet-stream" })),
  { "content-disposition": Schema.String, vary: Schema.String },
);

const ProbeGroup = HttpApiGroup.make("probe").add(
  HttpApiEndpoint.post("echo", "/probe/echo", {
    payload: Schema.Struct({ value: Schema.String, delay: Schema.Number }),
    success: Echo,
  }),
  HttpApiEndpoint.get("download", "/probe/download", { success: Download }),
  HttpApiEndpoint.get("stream", "/probe/stream", {
    success: HttpApiSchema.StreamUint8Array({ contentType: "application/x-probe-stream" }),
  }),
  HttpApiEndpoint.get("cookies", "/probe/cookies", { success: Schema.String }),
  HttpApiEndpoint.get("defect", "/probe/defect", { success: Schema.String }),
  HttpApiEndpoint.get("start", "/probe/start/:mode", {
    params: { mode: Schema.String },
    success: [Started, HttpApiSchema.NoContent],
  }),
);
const ProbeApi = HttpApi.make("probe-api").add(ProbeGroup);

const ProbeHandlers = HttpApiBuilder.group(ProbeApi, "probe", (handlers) =>
  handlers
    .handle("echo", ({ payload }) =>
      Effect.gen(function* () {
        const requestId = yield* RequestId;
        yield* Effect.sleep(payload.delay);
        return { requestId, value: payload.value };
      }),
    )
    .handle("download", () =>
      Effect.succeed(
        HttpApiSchema.withHeaders({
          body: new Uint8Array([0, 1, 2, 255]),
          headers: {
            "content-disposition": 'attachment; filename="probe.bin"',
            vary: "Accept-Encoding",
          },
        }),
      ),
    )
    .handle("stream", () =>
      Effect.succeed(Stream.make(new Uint8Array([0, 1]), new Uint8Array([2, 255]))),
    )
    // WithHeaders is a header record, so duplicate Set-Cookie values require the raw response escape hatch.
    .handleRaw("cookies", () =>
      Effect.succeed(
        HttpServerResponse.text("cookies").pipe(
          HttpServerResponse.setCookieUnsafe("session", "one", { httpOnly: true }),
          HttpServerResponse.setCookieUnsafe("challenge", "two", { httpOnly: true }),
        ),
      ),
    )
    .handle("defect", () => Effect.die("probe defect"))
    .handle("start", ({ params }) =>
      params.mode === "empty" ? Effect.void : Effect.map(RequestId, (requestId) => ({ requestId })),
    ),
);

const nativeOrigins = new Set(["capacitor://localhost", "https://localhost", "http://localhost"]);
const NativeCors = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const origin = request.headers.origin;
      if (origin === undefined || !nativeOrigins.has(origin)) return yield* httpEffect;
      if (request.method === "OPTIONS") {
        return HttpServerResponse.empty({
          headers: {
            "access-control-allow-origin": origin,
            "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
            "access-control-allow-headers": "Authorization, Content-Type",
            "access-control-max-age": "86400",
            vary: "Origin",
          },
        });
      }

      const response = yield* httpEffect;
      if (
        response.status === 101 ||
        (response.body instanceof HttpBody.Raw &&
          response.body.body instanceof Response &&
          response.body.body.webSocket !== undefined &&
          response.body.body.webSocket !== null)
      ) {
        return response;
      }
      return HttpServerResponse.setHeaders(response, {
        "access-control-allow-origin": origin,
        vary: response.headers.vary ? `${response.headers.vary}, Origin` : "Origin",
      });
    }),
  { global: true },
);
const Routes = Layer.merge(
  HttpApiBuilder.layer(ProbeApi).pipe(Layer.provide(ProbeHandlers)),
  NativeCors,
).pipe(Layer.provide(HttpServer.layerServices));
const effect = HttpRouter.toWebHandler(Routes, { disableLogger: true });
const app = new Hono<{ Bindings: { requestId: string } }>();

app.all("*", (context) =>
  effect.handler(context.req.raw, Context.make(RequestId, context.env.requestId)),
);

afterAll(effect.dispose);

const request = (path: string, requestId = "request", init?: RequestInit) =>
  app.request(`http://localhost${path}`, init, { requestId });

describe("Effect HttpApi compatibility", () => {
  it("keeps per-request context isolated through the Hono adapter", async () => {
    const [slow, fast] = await Promise.all([
      request("/probe/echo", "slow-env", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "slow", delay: 20 }),
      }),
      request("/probe/echo", "fast-env", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "fast", delay: 0 }),
      }),
    ]);

    expect(await slow.json()).toEqual({ requestId: "slow-env", value: "slow" });
    expect(await fast.json()).toEqual({ requestId: "fast-env", value: "fast" });
  });

  it("rejects invalid schema input and owns unknown probe routes", async () => {
    const invalid = await request("/probe/echo", "invalid", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: 1, delay: 0 }),
    });
    const missing = await request("/probe/missing");

    expect(invalid.status).toBe(400);
    expect(missing.status).toBe(404);
    // rc.108 exposes only the status here, so Bookclub still needs one outer error-envelope shim.
    expect(await invalid.text()).toBe("");
    expect(await missing.text()).toBe("");
  });

  it("preserves buffered bytes, dynamic headers, appended Vary, and cookies", async () => {
    const download = await request("/probe/download", "request", {
      headers: { origin: "capacitor://localhost" },
    });
    const cookies = await request("/probe/cookies");

    expect(new Uint8Array(await download.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 255]));
    expect(download.headers.get("content-type")).toBe("application/octet-stream");
    expect(download.headers.get("content-disposition")).toBe('attachment; filename="probe.bin"');
    expect(download.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    expect(download.headers.get("vary")).toBe("Accept-Encoding, Origin");
    expect(cookies.headers.getSetCookie()).toEqual([
      "session=one; HttpOnly",
      "challenge=two; HttpOnly",
    ]);
  });

  it("selects both declared success statuses on one endpoint", async () => {
    const started = await request("/probe/start/session", "status-env");
    const empty = await request("/probe/start/empty", "status-env");

    expect(started.status).toBe(200);
    await expect(started.json()).resolves.toEqual({ requestId: "status-env" });
    expect(empty.status).toBe(204);
    expect(await empty.text()).toBe("");
  });

  it("streams exact bytes through the Web response adapter", async () => {
    const response = await request("/probe/stream");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-probe-stream");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 255]));
  });

  it("uses the current empty default 500 response for an unhandled defect", async () => {
    const response = await request("/probe/defect");

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
  });

  it("short-circuits only allowed native preflights", async () => {
    const allowed = await request("/probe/echo", "request", {
      method: "OPTIONS",
      headers: { origin: "https://localhost" },
    });
    const disallowed = await request("/probe/echo", "request", {
      method: "OPTIONS",
      headers: { origin: "https://example.com" },
    });

    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(allowed.headers.get("access-control-allow-methods")).toBe(
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    expect(allowed.headers.get("access-control-allow-headers")).toBe("Authorization, Content-Type");
    expect(allowed.headers.get("access-control-max-age")).toBe("86400");
    expect(allowed.headers.get("vary")).toBe("Origin");
    expect(disallowed.status).toBe(404);
    expect(disallowed.headers.get("access-control-allow-origin")).toBeNull();
  });
});
