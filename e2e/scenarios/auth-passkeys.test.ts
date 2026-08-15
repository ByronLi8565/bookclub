import { expect } from "vitest";
import { scenario } from "../src/scenario.ts";

scenario("Auth · a registered passkey signs you in on its own", {}, async (ctx) => {
  const api = ctx.need("api");
  const auth = ctx.need("auth");

  const member = await api.newIdentity({ label: "member" });

  const authenticator = await auth.registerPasskey(member, "MacBook Touch ID");

  const passkeys = await auth.listPasskeys(member);
  expect(
    passkeys.map((p) => p.label),
    "the registered passkey is listed for the account",
  ).toContain("MacBook Touch ID");
  expect(passkeys, "exactly one passkey is registered").toHaveLength(1);

  const reauthed = await auth.loginWithPasskey(member.user.email, authenticator);
  expect(reauthed.user.id, "passkey login resolves to the same user").toBe(member.user.id);
  expect(reauthed.cookie, "and mints a real, independent session").not.toBe(member.cookie);

  const me = await api.request(reauthed, "/auth/me");
  expect(me.status, "the passkey session is accepted by /auth/me").toBe(200);
  expect(await me.json(), "and reports the right identity").toMatchObject({
    user: { id: member.user.id, email: member.user.email },
  });

  const stranger = await api.newIdentity({ label: "no-passkeys" });
  const options = await api.request(stranger, "/auth/passkey/login/options", {
    method: "POST",
    body: JSON.stringify({ email: stranger.user.email }),
  });
  expect(options.status, "an account without passkeys has no login options").toBe(404);
});
