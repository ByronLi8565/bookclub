import { describe, expect, it } from "vitest";
import { isDevAuth } from "../server/auth/devAuth.ts";

describe("isDevAuth", () => {
  it("uses explicit dev auth even when local email configuration is present", () => {
    expect(isDevAuth({ DEV_AUTH: "true", EMAIL: {}, EMAIL_FROM: "local@example.com" })).toBe(true);
  });

  it("retains the missing-email fallback used by e2e", () => {
    expect(isDevAuth({ EMAIL_FROM: "local@example.com" })).toBe(true);
  });

  it("keeps configured production email authentication enabled", () => {
    expect(isDevAuth({ EMAIL: {}, EMAIL_FROM: "login@example.com" })).toBe(false);
  });
});
