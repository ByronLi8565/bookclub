import { afterAll, describe, expect, it, vi } from "vitest";
import type { Env } from "../../server/env.ts";
import { mintSessionToken } from "../../server/auth/cookies.ts";
import { bookclubHttpFallback } from "../../server/http/live.ts";
import { DEFAULT_USER_PREFS } from "../../shared/types/userPrefs.ts";

// The `agents` SDK resolves Durable Object stubs through a module-level
// `getAgentByName` that every server handler imports directly, so there is no
// injection point to stand in for. Replacing that hard-wired import with an
// injectable locator is a server-wide refactor tracked separately; until then
// this seam test substitutes the module.
const agents = vi.hoisted(() => new Map<string, object>());
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock("agents", () => ({
  // `async` is load-bearing here, not stylistic: account handlers' `attempt`
  // trusts its callback to already return a Promise rather than wrapping it,
  // so a synchronous stub would throw at runtime even though nothing awaits.
  // oxlint-disable-next-line require-await
  getAgentByName: async (_namespace: DurableObjectNamespace, name: string) => agents.get(name),
}));

const env = (secret: string): Env =>
  Object.assign(Object.create(null), { SESSION_HMAC_SECRET: secret });
const API_PREFIXES = ["/auth", "/me", "/users", "/groups", "/admin"] as const;

afterAll(bookclubHttpFallback.dispose);

describe("Bookclub Worker HttpApi seam", () => {
  it("does not authenticate structured HTTP with a query token", async () => {
    const bindings = env("query-token-secret");
    const token = await mintSessionToken(bindings, {
      id: "user-1",
      email: "reader@example.com",
      displayName: "Reader",
      groupIds: [],
      createdAt: "2026-08-15T00:00:00.000Z",
    });

    agents.set("reader@example.com", { getPrefs: () => DEFAULT_USER_PREFS });
    const byQuery = await bookclubHttpFallback.handler(
      new Request(`https://bookclub.test/me/prefs?token=${token}`),
      bindings,
    );
    expect(byQuery.status, "a URL is logged and shared, so it is never a credential").toBe(401);
    const byBearer = await bookclubHttpFallback.handler(
      new Request("https://bookclub.test/me/prefs", {
        headers: { authorization: `Bearer ${token}` },
      }),
      bindings,
    );
    expect(byBearer.status, "the native app's bearer header still signs in").toBe(200);
  });

  it("owns bare and nested API prefixes with a JSON 404", async () => {
    const bindings = env("fallback-secret");

    for (const prefix of API_PREFIXES) {
      for (const path of [prefix, `${prefix}/missing`]) {
        const response = await bookclubHttpFallback.handler(
          new Request(`https://bookclub.test${path}`),
          bindings,
        );
        // `/groups` is itself a route, so an anonymous caller is refused before any 404.
        const groupsRoute = path.startsWith("/groups");
        expect(response.status, path).toBe(groupsRoute ? 401 : 404);
        await expect(response.json(), path).resolves.toEqual(
          groupsRoute
            ? { _tag: "Unauthenticated", error: "unauthenticated" }
            : { error: "not_found" },
        );
      }
    }
  });

  it("answers a malformed field with the code its endpoint documents", async () => {
    const bindings = env("field-secret");
    const token = await mintSessionToken(bindings, {
      id: "user-1",
      email: "reader@example.com",
      displayName: "Reader",
      groupIds: [],
      createdAt: "2026-08-15T00:00:00.000Z",
    });
    const response = await bookclubHttpFallback.handler(
      new Request("https://bookclub.test/me/password", {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ password: "short" }),
      }),
      bindings,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ _tag: "BadRequest", error: "weak_password" });
  });

  it("serves typed preferences and reading positions through the Worker adapter", async () => {
    const bindings = env("account-secret");
    const user = {
      id: "user-1",
      email: "reader@example.com",
      displayName: "Reader",
      groupIds: [],
      createdAt: "2026-08-15T00:00:00.000Z",
    };
    const position = {
      kind: "epub" as const,
      cfi: "epubcfi(/6/2)",
      percentage: 0.25,
      groupId: "group-1",
      sourceId: "source-1",
      updatedAt: "2026-08-15T00:00:00.000Z",
    };
    // Every stub method below is `async` for the same load-bearing reason as
    // `getAgentByName` above — see its comment.
    agents.set(user.email, {
      // oxlint-disable-next-line require-await
      getPrefs: async () => DEFAULT_USER_PREFS,
      // oxlint-disable-next-line require-await
      setPrefs: async () => DEFAULT_USER_PREFS,
      // oxlint-disable-next-line require-await
      getReadingPosition: async () => position,
      // oxlint-disable-next-line require-await
      setReadingPosition: async () => position,
    });
    agents.set("group-1", {
      // oxlint-disable-next-line require-await
      membership: async () => ({ isMember: true, role: "member" }),
      // oxlint-disable-next-line require-await
      getSummary: async () => ({
        sources: [position.sourceId],
        sourceMeta: { [position.sourceId]: { kind: "epub" } },
      }),
    });
    const token = await mintSessionToken(bindings, user);
    const request = (path: string, init?: RequestInit) =>
      bookclubHttpFallback.handler(
        new Request(`https://bookclub.test${path}`, {
          ...init,
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        }),
        bindings,
      );

    const getPrefs = await request("/me/prefs");
    const setPrefs = await request("/me/prefs", {
      method: "PUT",
      body: JSON.stringify({ prefs: DEFAULT_USER_PREFS }),
    });
    const getPosition = await request(
      `/me/reading-position?groupId=${position.groupId}&sourceId=${position.sourceId}`,
    );
    const setPosition = await request("/me/reading-position", {
      method: "PUT",
      body: JSON.stringify({ groupId: position.groupId, sourceId: position.sourceId, position }),
    });

    expect([getPrefs.status, setPrefs.status, getPosition.status, setPosition.status]).toEqual([
      200, 200, 200, 200,
    ]);
    await expect(getPrefs.json()).resolves.toEqual({ prefs: DEFAULT_USER_PREFS });
    await expect(setPrefs.json()).resolves.toEqual({ prefs: DEFAULT_USER_PREFS });
    await expect(getPosition.json()).resolves.toEqual({ position });
    await expect(setPosition.json()).resolves.toEqual({ position });
  });

  it("authenticates before decoding protected account input", async () => {
    const bindings = env("precedence-secret");
    const malformed = [
      new Request("https://bookclub.test/me/prefs", { method: "PUT", body: "{" }),
      new Request("https://bookclub.test/me/reading-position"),
      new Request("https://bookclub.test/me/reading-position", { method: "PUT", body: "{" }),
    ];

    for (const request of malformed) {
      const response = await bookclubHttpFallback.handler(request, bindings);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: "unauthenticated" });
    }
  });
});
