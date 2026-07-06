import { describe, expect, it } from "vitest";
import { challengeCookie, readChallenge } from "../server/auth/challenge.ts";

const SECRET = "test-secret";

function tokenFrom(setCookie: string): string {
  return setCookie.split(";")[0].split("=").slice(1).join("=");
}

function requestWith(token: string): Request {
  return new Request("https://bookclub.example/x", {
    headers: { Cookie: `bc_pk_challenge=${token}` },
  });
}

describe("passkey challenge cookie", () => {
  it("round-trips email and challenge", async () => {
    const cookie = await challengeCookie("a@b.com", "chal-123", SECRET);
    const result = await readChallenge(requestWith(tokenFrom(cookie)), SECRET);
    expect(result).toEqual({ email: "a@b.com", challenge: "chal-123" });
  });

  it("rejects a token signed with a different secret", async () => {
    const cookie = await challengeCookie("a@b.com", "chal-123", SECRET);
    const result = await readChallenge(requestWith(tokenFrom(cookie)), "other-secret");
    expect(result).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const cookie = await challengeCookie("a@b.com", "chal-123", SECRET);
    const [payload, sig] = tokenFrom(cookie).split(".");
    const forged = `${payload}x.${sig}`;
    expect(await readChallenge(requestWith(forged), SECRET)).toBeNull();
  });

  it("returns null when the cookie is absent", async () => {
    const request = new Request("https://bookclub.example/x");
    expect(await readChallenge(request, SECRET)).toBeNull();
  });
});
