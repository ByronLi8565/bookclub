import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { getAgentByName } from "agents";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpApi, HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi";
import { AuthHttp } from "../../shared/http/auth.ts";
import {
  BadRequest,
  Forbidden,
  InternalError,
  NotFound,
  RateLimited,
} from "../../shared/http/errors.ts";
import { normalizeEmail } from "../../shared/email.ts";
import { challengeCookie, readChallenge } from "../auth/challenge.ts";
import { clearedCookie, publicUser, sessionCredentials } from "../auth/cookies.ts";
import { RP_NAME, rpConfig, toStoredCredential, toWebAuthnCredential } from "../auth/webauthn.ts";
import { isDevAuth } from "../auth/devAuth.ts";
import { CurrentIdentity } from "../../shared/http/middleware.ts";
import { CloudflareEnv, CloudflareRequest } from "./cloudflare.ts";

const encoder = new TextEncoder();
const attempt = <A>(evaluate: () => PromiseLike<A>) =>
  Effect.tryPromise({
    try: async () => await evaluate(),
    catch: () => new InternalError({ error: "internal_error" }),
  });
export const AuthApi = HttpApi.make("auth-api").add(AuthHttp);
const rawJson = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });
const sourceRequest = (request: HttpServerRequest.HttpServerRequest): CloudflareRequest | null =>
  request.source instanceof CloudflareRequest ? request.source : null;

export const AuthHandlers = HttpApiBuilder.group(AuthApi, "auth", (handlers) =>
  handlers
    .handle("start", ({ payload }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const email = normalizeEmail(payload.email);
        if (!email) return yield* new BadRequest({ error: "invalid_email" });
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, email));
        if (isDevAuth(env)) {
          const user = yield* attempt(() => auth.devLogin(email));
          const { cookie, token } = yield* attempt(() => sessionCredentials(env, user));
          return HttpApiSchema.withHeaders({
            body: { devSignedIn: true, user: publicUser(user), token },
            headers: { "set-cookie": cookie },
          });
        }
        const sent = yield* attempt(() => auth.startLogin(email));
        if (!sent) return yield* new RateLimited({ error: "rate_limited" });
      }),
    )
    .handle("verify", ({ payload }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const email = normalizeEmail(payload.email);
        const code = payload.code.trim();
        if (!email || !code) return yield* new BadRequest({ error: "invalid_request" });
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, email));
        const result = yield* attempt(
          async () => await auth.verifyLogin(email, code, payload.displayName),
        );
        if (!result.ok) return yield* new BadRequest({ error: result.reason });
        const { cookie, token } = yield* attempt(() => sessionCredentials(env, result.user));
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
        const email = normalizeEmail(payload.email);
        if (!email || !payload.password) return yield* new BadRequest({ error: "invalid_request" });
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, email));
        const result = yield* attempt(
          async () => await auth.loginWithPassword(email, payload.password),
        );
        if (!result.ok)
          return yield* result.reason === "rate_limited"
            ? new RateLimited({ error: result.reason })
            : new BadRequest({ error: result.reason });
        const { cookie, token } = yield* attempt(() => sessionCredentials(env, result.user));
        return HttpApiSchema.withHeaders({
          body: { user: publicUser(result.user), token },
          headers: { "set-cookie": cookie },
        });
      }),
    )
    .handle("setPassword", ({ payload }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        if (payload.password.length < 8) return yield* new BadRequest({ error: "weak_password" });
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, me.email));
        const result = yield* attempt(
          async () => await auth.setPassword(payload.password, payload.currentPassword),
        );
        if (!result.ok)
          return yield* result.reason === "bad_current"
            ? new Forbidden({ error: result.reason })
            : new BadRequest({ error: result.reason });
      }),
    )
    .handle("removePassword", ({ payload }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, me.email));
        const result = yield* attempt(
          async () => await auth.removePassword(payload.currentPassword),
        );
        if (!result.ok)
          return yield* result.reason === "bad_current"
            ? new Forbidden({ error: result.reason })
            : new BadRequest({ error: result.reason });
      }),
    )
    .handle("passkeyRegistrationOptions", () =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const source = sourceRequest(request);
        if (source === null) return rawJson({ error: "internal_error" }, 500);
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, me.email));
        const existing = yield* attempt(() => auth.listCredentials());
        const { rpID } = rpConfig(source);
        const options = yield* attempt(() =>
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
        yield* attempt(() => auth.startRegistration(options.challenge));
        return rawJson(options);
      }),
    )
    .handle("verifyPasskeyRegistration", ({ payload }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const source = sourceRequest(request);
        if (source === null) return rawJson({ error: "internal_error" }, 500);
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, me.email));
        const challenge = yield* attempt(() => auth.takeRegistrationChallenge());
        if (!challenge) return rawJson({ error: "challenge_expired" }, 400);
        const { rpID, origin } = rpConfig(source);
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
        yield* attempt(() =>
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
        const request = yield* HttpServerRequest.HttpServerRequest;
        const source = sourceRequest(request);
        if (source === null) return rawJson({ error: "internal_error" }, 500);
        const email = normalizeEmail(payload.email);
        if (!email) return rawJson({ error: "invalid_email" }, 400);
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, email));
        const credentials = yield* attempt(() => auth.listCredentials());
        if (credentials.length === 0) return rawJson({ error: "no_passkeys" }, 404);
        const { rpID } = rpConfig(source);
        const options = yield* attempt(() =>
          generateAuthenticationOptions({
            rpID,
            allowCredentials: credentials.map((credential) => ({
              id: credential.id,
              transports: credential.transports,
            })),
            userVerification: "preferred",
          }),
        );
        const cookie = yield* attempt(() =>
          challengeCookie(email, options.challenge, env.SESSION_HMAC_SECRET),
        );
        return rawJson(options).pipe(HttpServerResponse.setHeader("set-cookie", cookie));
      }),
    )
    .handle("verifyPasskeyLogin", ({ payload }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const source = sourceRequest(request);
        if (source === null) return rawJson({ error: "internal_error" }, 500);
        const pending = yield* attempt(() => readChallenge(source, env.SESSION_HMAC_SECRET));
        if (!pending) return rawJson({ error: "challenge_expired" }, 400);
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, pending.email));
        const stored = yield* attempt(() => auth.getCredentialById(payload.response.id));
        if (!stored) return rawJson({ error: "unknown_credential" }, 400);
        const { rpID, origin } = rpConfig(source);
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
        yield* attempt(() =>
          auth.bumpCounter(stored.id, verification.value.authenticationInfo.newCounter),
        );
        const user = yield* attempt(() => auth.getUser());
        if (!user) return rawJson({ error: "no_user" }, 400);
        const { cookie, token } = yield* attempt(() => sessionCredentials(env, user));
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
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, me.email));
        return {
          passkeys: yield* attempt(() => auth.listPasskeys()),
          hasPassword: yield* attempt(() => auth.hasPassword()),
        };
      }),
    )
    .handle("removePasskey", ({ params }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, me.email));
        if (!(yield* attempt(() => auth.removeCredential(params.id))))
          return yield* new NotFound({ error: "not_found" });
      }),
    ),
);
