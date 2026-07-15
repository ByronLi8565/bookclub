import { describe, expect, it } from "vitest";
import { isDevAuth } from "../server/auth/devAuth.ts";

describe("isDevAuth", () => {
  it("uses explicit dev auth", () => {
    expect(isDevAuth({ DEV_AUTH: "true" })).toBe(true);
  });

  it("fails closed when dev auth is not explicitly enabled", () => {
    expect(isDevAuth({})).toBe(false);
  });
});
