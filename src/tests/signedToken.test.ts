import { afterEach, describe, expect, it, vi } from "vitest";
import { challengeCookie, readChallenge } from "../server/auth/challenge.ts";
import { signSession, verifySession } from "../server/auth/session.ts";

const SECRET = "test-secret";
const NOW = 1_700_000_000_000;
const CLAIMS = { userId: "user-123", email: "a@b.com", name: "Reader", exp: NOW };
// Independently generated HMAC-SHA256 fixtures freeze the existing token wire format.
const SESSION =
  "eyJ1c2VySWQiOiJ1c2VyLTEyMyIsImVtYWlsIjoiYUBiLmNvbSIsIm5hbWUiOiJSZWFkZXIiLCJleHAiOjE3MDAwMDAwMDAwMDB9.wC7riqzTKsr98yRP-12AwdJCsbA0eRYNVvEgHrZSquY";
const CHALLENGE =
  "eyJlbWFpbCI6ImFAYi5jb20iLCJjaGFsbGVuZ2UiOiJjaGFsLTEyMyIsImV4cCI6MTcwMDAwMDMwMDAwMH0.C8vumkGc3vlnp77Oex54fylRjl27_C0T_NGeUkV0ny0";
const BAD_SESSION =
  "eyJ1c2VySWQiOiJ1c2VyLTEyMyIsImVtYWlsIjoxLCJuYW1lIjoiUmVhZGVyIiwiZXhwIjoxNzAwMDAwMDAwMDAwfQ.kPilLAUWydwd3bIKv7CNOTNxEJhP2wPkt7-5xbWd5tM";
const BAD_CHALLENGE =
  "eyJlbWFpbCI6MSwiY2hhbGxlbmdlIjoiY2hhbC0xMjMiLCJleHAiOjE3MDAwMDAzMDAwMDB9.Alf5G091-sPpgtXDBmU2nJgqJCEqGAslyCoC33vRIcc";

const requestWith = (token: string) => `bc_pk_challenge=${token}`;

afterEach(() => vi.restoreAllMocks());

describe("signed token compatibility", () => {
  it("preserves existing session bytes and accepts a token exactly at expiration", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    expect(await signSession(CLAIMS, SECRET)).toBe(SESSION);
    expect(await verifySession(SESSION, SECRET)).toEqual(CLAIMS);
    vi.mocked(Date.now).mockReturnValue(NOW + 1);
    expect(await verifySession(SESSION, SECRET)).toBeNull();
  });

  it("preserves challenge cookie bytes, lifetime, and expiration boundary", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    expect(await challengeCookie("a@b.com", "chal-123", SECRET)).toBe(
      `bc_pk_challenge=${CHALLENGE}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=300`,
    );
    vi.mocked(Date.now).mockReturnValue(NOW + 300_000);
    expect(await readChallenge(requestWith(CHALLENGE), SECRET)).toEqual({
      email: "a@b.com",
      challenge: "chal-123",
      exp: NOW + 300_000,
    });
    vi.mocked(Date.now).mockReturnValue(NOW + 300_001);
    expect(await readChallenge(requestWith(CHALLENGE), SECRET)).toBeNull();
  });

  it("rejects correctly signed claims that do not match their schema", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    expect(await verifySession(BAD_SESSION, SECRET)).toBeNull();
    expect(await readChallenge(requestWith(BAD_CHALLENGE), SECRET)).toBeNull();
    expect(await verifySession(CHALLENGE, SECRET)).toBeNull();
    expect(await readChallenge(requestWith(SESSION), SECRET)).toBeNull();
  });

  it("rejects malformed tokens, tampering, and the wrong secret", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    for (const token of ["", "no-dot", "a.%", `${SESSION}x`, `x${SESSION}`]) {
      expect(await verifySession(token, SECRET)).toBeNull();
      expect(await readChallenge(requestWith(token), SECRET)).toBeNull();
    }
    expect(await verifySession(SESSION, "other-secret")).toBeNull();
  });

  it("propagates key import failures through both public verification paths", async () => {
    const failure = new Error("key import failed");
    vi.spyOn(crypto.subtle, "importKey").mockRejectedValue(failure);
    await expect(verifySession(SESSION, SECRET)).rejects.toBe(failure);
    await expect(readChallenge(requestWith(CHALLENGE), SECRET)).rejects.toBe(failure);
  });
});
