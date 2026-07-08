import { getAgentByName } from "agents";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { Hono } from "hono";
import { normalizeEmail } from "../../shared/email.ts";
import type { Env } from "../env.ts";
import { readJson } from "../http.ts";
import { currentIdentity, publicUser, sessionCredentials } from "../auth/cookies.ts";
import { challengeCookie, clearedChallengeCookie, readChallenge } from "../auth/challenge.ts";
import { RP_NAME, rpConfig, toStoredCredential, toWebAuthnCredential } from "../auth/webauthn.ts";

const encoder = new TextEncoder();

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function registerAuthRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post("/auth/password", async (c) => {
    const body = await readJson(c.req.raw);
    const email = normalizeEmail(body?.email);
    const password = str(body?.password);
    if (!email || !password) return c.json({ error: "invalid_request" }, 400);

    const auth = await getAgentByName(c.env.AuthAgent, email);
    const result = await auth.loginWithPassword(email, password);
    if (!result.ok) {
      const status = result.reason === "rate_limited" ? 429 : 400;
      return c.json({ error: result.reason }, status);
    }
    const { cookie, token } = await sessionCredentials(c.env, result.user);
    c.header("Set-Cookie", cookie);
    return c.json({ user: publicUser(result.user), token });
  });

  app.put("/me/password", async (c) => {
    const me = await currentIdentity(c.req.raw, c.env);
    if (!me) return c.json({ error: "unauthenticated" }, 401);
    const body = await readJson(c.req.raw);
    const next = str(body?.password);
    const current = str(body?.currentPassword) ?? undefined;
    if (!next || next.length < 8) return c.json({ error: "weak_password" }, 400);

    const auth = await getAgentByName(c.env.AuthAgent, me.email);
    const result = await auth.setPassword(next, current);
    if (!result.ok) {
      const status = result.reason === "bad_current" ? 403 : 400;
      return c.json({ error: result.reason }, status);
    }
    return c.body(null, 204);
  });

  app.delete("/me/password", async (c) => {
    const me = await currentIdentity(c.req.raw, c.env);
    if (!me) return c.json({ error: "unauthenticated" }, 401);
    const body = await readJson(c.req.raw);
    const current = str(body?.currentPassword);
    if (!current) return c.json({ error: "invalid_request" }, 400);

    const auth = await getAgentByName(c.env.AuthAgent, me.email);
    const result = await auth.removePassword(current);
    if (!result.ok) {
      const status = result.reason === "bad_current" ? 403 : 400;
      return c.json({ error: result.reason }, status);
    }
    return c.body(null, 204);
  });

  app.post("/auth/passkey/register/options", async (c) => {
    const me = await currentIdentity(c.req.raw, c.env);
    if (!me) return c.json({ error: "unauthenticated" }, 401);

    const auth = await getAgentByName(c.env.AuthAgent, me.email);
    const existing = await auth.listCredentials();
    const { rpID } = rpConfig(c.req.raw);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userID: encoder.encode(me.id),
      userName: me.email,
      userDisplayName: me.name,
      attestationType: "none",
      excludeCredentials: existing.map((cred) => ({ id: cred.id, transports: cred.transports })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    });
    await auth.startRegistration(options.challenge);
    return c.json(options);
  });

  app.post("/auth/passkey/register/verify", async (c) => {
    const me = await currentIdentity(c.req.raw, c.env);
    if (!me) return c.json({ error: "unauthenticated" }, 401);
    const body = await readJson(c.req.raw);
    const response = body?.response as RegistrationResponseJSON | undefined;
    const label = str(body?.label) || "Passkey";
    if (!response) return c.json({ error: "invalid_request" }, 400);

    const auth = await getAgentByName(c.env.AuthAgent, me.email);
    const expectedChallenge = await auth.takeRegistrationChallenge();
    if (!expectedChallenge) return c.json({ error: "challenge_expired" }, 400);

    const { rpID, origin } = rpConfig(c.req.raw);
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: false,
      });
    } catch {
      return c.json({ error: "verification_failed" }, 400);
    }
    if (!verification.verified || !verification.registrationInfo) {
      return c.json({ error: "verification_failed" }, 400);
    }
    await auth.addCredential(toStoredCredential(verification.registrationInfo.credential, label));
    return c.json({ ok: true });
  });

  app.post("/auth/passkey/login/options", async (c) => {
    const body = await readJson(c.req.raw);
    const email = normalizeEmail(body?.email);
    if (!email) return c.json({ error: "invalid_email" }, 400);

    const auth = await getAgentByName(c.env.AuthAgent, email);
    const credentials = await auth.listCredentials();
    if (credentials.length === 0) return c.json({ error: "no_passkeys" }, 404);

    const { rpID } = rpConfig(c.req.raw);
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: credentials.map((cred) => ({ id: cred.id, transports: cred.transports })),
      userVerification: "preferred",
    });
    c.header(
      "Set-Cookie",
      await challengeCookie(email, options.challenge, c.env.SESSION_HMAC_SECRET),
    );
    return c.json(options);
  });

  app.post("/auth/passkey/login/verify", async (c) => {
    const body = await readJson(c.req.raw);
    const response = body?.response as AuthenticationResponseJSON | undefined;
    if (!response) return c.json({ error: "invalid_request" }, 400);

    const pending = await readChallenge(c.req.raw, c.env.SESSION_HMAC_SECRET);
    if (!pending) return c.json({ error: "challenge_expired" }, 400);

    const auth = await getAgentByName(c.env.AuthAgent, pending.email);
    const stored = await auth.getCredentialById(response.id);
    if (!stored) return c.json({ error: "unknown_credential" }, 400);

    const { rpID, origin } = rpConfig(c.req.raw);
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: pending.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: toWebAuthnCredential(stored),
        requireUserVerification: false,
      });
    } catch {
      return c.json({ error: "verification_failed" }, 400);
    }
    if (!verification.verified) return c.json({ error: "verification_failed" }, 400);

    await auth.bumpCounter(stored.id, verification.authenticationInfo.newCounter);
    const user = await auth.getUser();
    if (!user) return c.json({ error: "no_user" }, 400);

    const { cookie, token } = await sessionCredentials(c.env, user);
    c.header("Set-Cookie", clearedChallengeCookie(), { append: true });
    c.header("Set-Cookie", cookie, { append: true });
    return c.json({ user: publicUser(user), token });
  });

  app.get("/me/passkeys", async (c) => {
    const me = await currentIdentity(c.req.raw, c.env);
    if (!me) return c.json({ error: "unauthenticated" }, 401);
    const auth = await getAgentByName(c.env.AuthAgent, me.email);
    return c.json({ passkeys: await auth.listPasskeys() });
  });

  app.delete("/me/passkeys/:id", async (c) => {
    const me = await currentIdentity(c.req.raw, c.env);
    if (!me) return c.json({ error: "unauthenticated" }, 401);
    const auth = await getAgentByName(c.env.AuthAgent, me.email);
    const removed = await auth.removeCredential(c.req.param("id"));
    if (!removed) return c.json({ error: "not_found" }, 404);
    return c.body(null, 204);
  });
}
