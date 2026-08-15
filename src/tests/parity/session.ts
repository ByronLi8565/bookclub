import type { Session } from "../../client/app/useSession.ts";

/**
 * A real `Session`, not a stand-in: the interface is small enough to implement
 * outright, so a parity test drives the same code paths the application does.
 */
export const testSession = (overrides: Partial<Session> = {}): Session => ({
  status: "anon",
  user: null,
  startLogin: () => Promise.resolve({ ok: true, devSignedIn: false }),
  verify: () => Promise.resolve({ ok: true }),
  loginWithPassword: () => Promise.resolve({ ok: false, error: "bad_password" }),
  passkeyLogin: () => Promise.resolve({ ok: false, error: "passkey_failed" }),
  signOut: () => Promise.resolve(),
  ...overrides,
});
