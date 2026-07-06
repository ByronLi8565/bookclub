import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../server/auth/password.ts";

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("Correct horse battery staple", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("uses a random salt so equal passwords hash differently", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a.hash).not.toEqual(b.hash);
    expect(a.salt).not.toEqual(b.salt);
    // ...yet both still verify.
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("returns false on a corrupt stored record instead of throwing", async () => {
    expect(await verifyPassword("x", { hash: "!!!", salt: "!!!", iterations: 1000 })).toBe(false);
  });
});
