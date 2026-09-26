import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi";
import { BookclubHttp } from "../../shared/http/BookclubHttp.ts";
import { BadRequest, Forbidden, NotFound, RateLimited } from "../../shared/http/errors.ts";
import { challengeCookie, readChallenge } from "../auth/challenge.ts";
import { clearedCookie, publicUser, sessionCredentials } from "../auth/cookies.ts";
import { RP_NAME, rpConfig, toStoredCredential, toWebAuthnCredential } from "../auth/webauthn.ts";
import { CurrentIdentity } from "../../shared/http/middleware.ts";
import type { AuthFailureReason } from "../state/AuthAgent.ts";
import { CloudflareEnv } from "./cloudflare.ts";
import { authAgent, io } from "./io.ts";

const encoder = new TextEncoder();
const rawJson = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });
const myAccount = Effect.flatMap(CurrentIdentity, (me) => authAgent(me.email));
const relyingParty = Effect.map(HttpServerRequest.HttpServerRequest, (request) =>
  rpConfig(request.originalUrl),
);

const passwordFailure = (reason: AuthFailureReason) => {
  if (reason === "rate_limited") return new RateLimited({ error: reason });
  if (reason === "bad_current") return new Forbidden({ error: reason });
  return new BadRequest({ error: reason });
};

export const AuthHandlers = HttpApiBuilder.group(BookclubHttp, "auth", (handlers) =>
  handlers
    .handle("start", ({ payload }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const { email } = payload;
        const auth = yield* authAgent(email);
        if (env.DEV_AUTH === "true") {
          const user = yield* io(() => auth.devLogin(email));
          const { cookie, token } = yield* io(() => sessionCredentials(env, user));
          return HttpApiSchema.withHeaders({
            body: { devSignedIn: true, user: publicUser(user), token },
            headers: { "set-cookie": cookie },
          });
        }
        const sent = yield* io(() => auth.startLogin(email));
        if (!sent) return yield* new RateLimited({ error: "rate_limited" });
      }),
    )
    .handle("verify", ({ payload }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const { email, code } = payload;
        const auth = yield* authAgent(email);
        const result = yield* io(() => auth.verifyLogin(email, code, payload.displayName));
        if (!result.ok) return yield* new BadRequest({ error: result.reason });
        const { cookie, token } = yield* io(() => sessionCredentials(env, result.user));
        return HttpApiSchema.withHeaders({
          body: { user: publicUser(result.user), token },
          headers: { "set-cookie": cookie },
        });
      }),
    )
    .handle("signout", () =>
      Effect.succeed(
        HttpApiSchema.withHeaders({ body: undefined, headers: { "set-cookie": clearedCookie() } }),
      ),
    )
    .handle("me", () => Effect.map(CurrentIdentity, (identity) => ({ user: identity })))
    .handle("passwordLogin", ({ payload }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const auth = yield* authAgent(payload.email);
        const result = yield* io(() => auth.loginWithPassword(payload.email, payload.password));
        if (!result.ok) {
          return yield* result.reason === "rate_limited"
            ? new RateLimited({ error: result.reason })
            : new BadRequest({ error: result.reason });
        }
        const { cookie, token } = yield* io(() => sessionCredentials(env, result.user));
        return HttpApiSchema.withHeaders({
          body: { user: publicUser(result.user), token },
          headers: { "set-cookie": cookie },
        });
      }),
    )
    .handle("setPassword", ({ payload }) =>
      Effect.gen(function* () {
        const auth = yield* myAccount;
        const result = yield* io(() => auth.setPassword(payload.password, payload.currentPassword));
        if (!result.ok) return yield* passwordFailure(result.reason);
      }),
    )
    .handle("removePassword", ({ payload }) =>
      Effect.gen(function* () {
        const auth = yield* myAccount;
        const result = yield* io(() => auth.removePassword(payload.currentPassword));
        if (!result.ok) return yield* passwordFailure(result.reason);
      }),
    )
    .handle("passkeyRegistrationOptions", () =>
      Effect.gen(function* () {
        const me = yield* CurrentIdentity;
        const auth = yield* myAccount;
        const existing = yield* io(() => auth.listCredentials());
        const { rpID } = yield* relyingParty;
        const options = yield* io(() =>
          generateRegistrationOptions({
            rpName: RP_NAME,
            rpID,
            userID: encoder.encode(me.id),
            userName: me.email,
            userDisplayName: me.name,
            attestationType: "none",
            excludeCredentials: existing.map((credential) => ({
              id: credential.id,
              transports: credential.transports,
            })),
            authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
          }),
        );
        yield* io(() => auth.startRegistration(options.challenge));
        return rawJson(options);
      }),
    )
    .handle("verifyPasskeyRegistration", ({ payload }) =>
      Effect.gen(function* () {
        const auth = yield* myAccount;
        const challenge = yield* io(() => auth.takeRegistrationChallenge());
        if (!challenge) return rawJson({ error: "challenge_expired" }, 400);
        const { rpID, origin } = yield* relyingParty;
        const verification = yield* Effect.tryPromise(() =>
          verifyRegistrationResponse({
            response: payload.response,
            expectedChallenge: challenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            requireUserVerification: false,
          }),
        ).pipe(Effect.option);
        if (
          verification._tag === "None" ||
          !verification.value.verified ||
          !verification.value.registrationInfo
        )
          return rawJson({ error: "verification_failed" }, 400);
        yield* io(() =>
          auth.addCredential(
            toStoredCredential(
              verification.value.registrationInfo!.credential,
              payload.label || "Passkey",
            ),
          ),
        );
        return rawJson({ ok: true });
      }),
    )
    .handle("passkeyLoginOptions", ({ payload }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const { email } = payload;
        const auth = yield* authAgent(email);
        const credentials = yield* io(() => auth.listCredentials());
        if (credentials.length === 0) return rawJson({ error: "no_passkeys" }, 404);
        const { rpID } = yield* relyingParty;
        const options = yield* io(() =>
          generateAuthenticationOptions({
            rpID,
            allowCredentials: credentials.map((credential) => ({
              id: credential.id,
              transports: credential.transports,
            })),
            userVerification: "preferred",
          }),
        );
        const cookie = yield* io(() =>
          challengeCookie(email, options.challenge, env.SESSION_HMAC_SECRET),
        );
        return rawJson(options).pipe(HttpServerResponse.setHeader("set-cookie", cookie));
      }),
    )
    .handle("verifyPasskeyLogin", ({ payload }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const pending = yield* io(() =>
          readChallenge(request.headers.cookie, env.SESSION_HMAC_SECRET),
        );
        if (!pending) return rawJson({ error: "challenge_expired" }, 400);
        const auth = yield* authAgent(pending.email);
        const stored = yield* io(() => auth.getCredentialById(payload.response.id));
        if (!stored) return rawJson({ error: "unknown_credential" }, 400);
        const { rpID, origin } = yield* relyingParty;
        const verification = yield* Effect.tryPromise(() =>
          verifyAuthenticationResponse({
            response: payload.response,
            expectedChallenge: pending.challenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            credential: toWebAuthnCredential(stored),
            requireUserVerification: false,
          }),
        ).pipe(Effect.option);
        if (verification._tag === "None" || !verification.value.verified)
          return rawJson({ error: "verification_failed" }, 400);
        // A signed challenge stays valid until it expires, so the account spends it here.
        if (!(yield* io(() => auth.consumeLoginChallenge(pending.challenge, pending.exp)))) {
          return rawJson({ error: "challenge_expired" }, 400);
        }
        yield* io(() =>
          auth.bumpCounter(stored.id, verification.value.authenticationInfo.newCounter),
        );
        const user = yield* io(() => auth.getUser());
        if (!user) return rawJson({ error: "no_user" }, 400);
        const { cookie, token } = yield* io(() => sessionCredentials(env, user));
        return rawJson({ user: publicUser(user), token }).pipe(
          HttpServerResponse.setCookieUnsafe("bc_pk_challenge", "", {
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            path: "/",
            maxAge: 0,
          }),
          HttpServerResponse.setHeader("set-cookie", cookie),
        );
      }),
    )
    .handle("passkeys", () =>
      Effect.gen(function* () {
        const auth = yield* myAccount;
        return {
          passkeys: yield* io(() => auth.listPasskeys()),
          hasPassword: yield* io(() => auth.hasPassword()),
        };
      }),
    )
    .handle("removePasskey", ({ params }) =>
      Effect.gen(function* () {
        const auth = yield* myAccount;
        if (!(yield* io(() => auth.removeCredential(params.id))))
          return yield* new NotFound({ error: "not_found" });
      }),
    ),
);
