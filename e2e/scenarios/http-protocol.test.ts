import { expect } from "vitest";
import { scenario } from "../src/scenario.ts";

scenario("HTTP · native CORS accepts only approved app origins", {}, async (ctx) => {
  const api = ctx.need("api");

  const allowed = await api.request(null, "/auth/me", {
    method: "OPTIONS",
    headers: {
      Origin: "capacitor://localhost",
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "Authorization, Content-Type",
    },
  });
  expect(allowed.status, "an approved native preflight is answered without a body").toBe(204);
  expect(await allowed.text(), "the preflight response stays empty").toBe("");
  expect(
    allowed.headers.get("Access-Control-Allow-Origin"),
    "the requesting app origin is echoed",
  ).toBe("capacitor://localhost");
  expect(
    allowed.headers.get("Access-Control-Allow-Methods"),
    "the native method policy is stable",
  ).toBe("GET, POST, PUT, DELETE, OPTIONS");
  expect(
    allowed.headers.get("Access-Control-Allow-Headers"),
    "bearer and JSON headers are allowed",
  ).toBe("Authorization, Content-Type");
  expect(
    allowed.headers.get("Access-Control-Max-Age"),
    "the browser may cache the policy for one day",
  ).toBe("86400");
  expect(allowed.headers.get("Vary"), "shared caches separate responses by origin").toBe("Origin");

  const disallowed = await api.request(null, "/auth/me", {
    method: "OPTIONS",
    headers: { Origin: "https://example.com", "Access-Control-Request-Method": "GET" },
  });
  expect(
    disallowed.headers.get("Access-Control-Allow-Origin"),
    "an ordinary web origin receives no cross-origin permission",
  ).toBeNull();
  expect(
    disallowed.headers.get("Access-Control-Allow-Credentials"),
    "the worker never grants credentialed cross-origin access",
  ).toBeNull();
});
