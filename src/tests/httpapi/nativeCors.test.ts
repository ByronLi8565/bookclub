import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { afterAll, describe, expect, it } from "vitest";
import { nativeCors, NativeCorsLayer } from "../../server/http/nativeCors.ts";

const Routes = Layer.mergeAll(
  HttpRouter.add("GET", "/plain", HttpServerResponse.text("plain")),
  HttpRouter.add(
    "GET",
    "/varied",
    HttpServerResponse.text("varied", { headers: { vary: "Accept-Encoding" } }),
  ),
  NativeCorsLayer,
);

const app = HttpRouter.toWebHandler(Routes, { disableLogger: true });

afterAll(app.dispose);

const request = (path: string, init?: RequestInit) =>
  app.handler(new Request(`http://localhost${path}`, init));

const runWithOrigin = (
  origin: string,
  method: string,
  response: HttpServerResponse.HttpServerResponse,
) =>
  Effect.runPromise(
    nativeCors(Effect.succeed(response)).pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(
          new Request("http://localhost/agents/note-agent/x", { method, headers: { origin } }),
        ),
      ),
    ),
  );

// workerd's upgrade Response is unavailable under vitest, so a real Response carries a stand-in
// webSocket property; only its presence on an inner raw Response drives the pass-through branch.
const webSocketResponse = () => {
  const inner = new Response(null, { status: 200 });
  Object.defineProperty(inner, "webSocket", { value: { accept: () => {} } });
  return HttpServerResponse.raw(inner);
};

describe("native CORS middleware", () => {
  it("answers an allowed native preflight with the full policy", async () => {
    const response = await request("/plain", {
      method: "OPTIONS",
      headers: { origin: "capacitor://localhost" },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "Authorization, Content-Type",
    );
    expect(response.headers.get("access-control-max-age")).toBe("86400");
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("accepts every allowed native origin", async () => {
    for (const origin of ["capacitor://localhost", "https://localhost", "http://localhost"]) {
      const response = await request("/plain", { headers: { origin } });

      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
      expect(response.headers.get("vary")).toBe("Origin");
    }
  });

  it("lets a disallowed preflight fall through to the router", async () => {
    const response = await request("/plain", {
      method: "OPTIONS",
      headers: { origin: "https://example.com" },
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-methods")).toBeNull();
    expect(response.headers.get("vary")).toBeNull();
  });

  it("leaves a non-native origin and a same-origin web request untouched", async () => {
    const foreign = await request("/plain", { headers: { origin: "https://bookclub.byron.land" } });
    const sameOrigin = await request("/plain");

    expect(foreign.status).toBe(200);
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
    expect(foreign.headers.get("vary")).toBeNull();
    expect(sameOrigin.headers.get("access-control-allow-origin")).toBeNull();
    expect(sameOrigin.headers.get("vary")).toBeNull();
  });

  it("appends Origin to an existing Vary instead of overwriting it", async () => {
    const response = await request("/varied", { headers: { origin: "https://localhost" } });

    expect(response.headers.get("vary")).toBe("Accept-Encoding, Origin");
    expect(response.headers.get("access-control-allow-origin")).toBe("https://localhost");
  });

  it("passes a raw response wrapping an inner WebSocket Response through untouched", async () => {
    const upgrade = webSocketResponse();
    const result = await runWithOrigin("capacitor://localhost", "GET", upgrade);

    expect(result).toBe(upgrade);
    expect(result.headers["access-control-allow-origin"]).toBeUndefined();
    expect(result.headers.vary).toBeUndefined();
    expect(result.status).toBe(200);
  });

  it("passes a genuine 101 response through untouched", async () => {
    const upgrade = HttpServerResponse.empty({ status: 101 });
    const result = await runWithOrigin("capacitor://localhost", "GET", upgrade);

    expect(result).toBe(upgrade);
    expect(result.headers["access-control-allow-origin"]).toBeUndefined();
    expect(result.headers.vary).toBeUndefined();
    expect(result.status).toBe(101);
  });

  it("still decorates a raw response that carries no WebSocket", async () => {
    const raw = HttpServerResponse.raw(new Response("body"));
    const result = await runWithOrigin("capacitor://localhost", "GET", raw);

    expect(result.headers["access-control-allow-origin"]).toBe("capacitor://localhost");
    expect(result.headers.vary).toBe("Origin");
  });
});
