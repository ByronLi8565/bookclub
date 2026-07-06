import { expect } from "vitest";
import { scenario } from "../src/scenario.ts";

// The optional-password promise: a member can set a password while signed in and
// then, from a brand-new client with no session, sign in with just email +
// password — no email code round-trip. A wrong password is rejected, and an
// account that never set one is reported distinctly (so the UI can fall back to
// a code rather than implying the password was wrong). Driven entirely through
// the public /auth and /me routes.

scenario("Auth · a set password signs you in from a fresh client, no code", {}, async (ctx) => {
  const api = ctx.need("api");
  const auth = ctx.need("auth");

  const member = await api.newIdentity({ label: "member" });

  // Set a password on the signed-in account.
  const set = await auth.setPassword(member, "correct horse battery staple");
  expect(set.status, "setting a password succeeds").toBe(204);

  // A weak password is refused.
  const weak = await auth.setPassword(member, "short", "correct horse battery staple");
  expect(weak.status, "a too-short password is rejected").toBe(400);
  expect(await weak.json(), "with a weak_password reason").toMatchObject({
    error: "weak_password",
  });

  // From a clean client (no cookie), the password alone signs the same user in.
  const reauthed = await auth.loginWithPassword(member.user.email, "correct horse battery staple");
  expect(reauthed.user.id, "password login resolves to the same user").toBe(member.user.id);
  expect(reauthed.cookie, "and mints a real, independent session").not.toBe(member.cookie);

  // The minted session is genuinely authenticated.
  const me = await api.request(reauthed, "/auth/me");
  expect(me.status, "the password session is accepted by /auth/me").toBe(200);
  expect(await me.json(), "and reports the right identity").toMatchObject({
    user: { id: member.user.id, email: member.user.email },
  });

  // A wrong password is rejected as such.
  const wrong = await auth.attemptPassword(member.user.email, "not my password");
  expect(wrong.status, "a wrong password is a 400").toBe(400);
  expect(await wrong.json(), "reported as bad_password").toMatchObject({ error: "bad_password" });

  // An account that never set a password is reported distinctly from a bad one.
  const other = await api.newIdentity({ label: "passwordless" });
  const none = await auth.attemptPassword(other.user.email, "anything");
  expect(none.status, "a passwordless account can't password-login").toBe(400);
  expect(await none.json(), "reported as no_password, not bad_password").toMatchObject({
    error: "no_password",
  });
});
