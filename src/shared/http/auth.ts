import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";
import { PasskeyInfo } from "../types/passkeys.ts";
import { JsonObject, PublicUser, Session } from "./compatibility.ts";
import { AuthenticationResponse, RegistrationResponse } from "./webauthn.ts";
import { Authentication } from "./middleware.ts";
import {
  BadRequestError,
  ForbiddenError,
  InternalErrorSchema,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
} from "./errors.ts";

const DevSession = Schema.Struct({
  devSignedIn: Schema.Literal(true),
  user: PublicUser,
  token: Schema.String,
}).pipe(HttpApiSchema.status(200));
// `set-cookie` is a forbidden response header: the browser stores the cookie but
// hides it from `fetch`, so a client decoding these responses never sees it.
const CookieHeaders = { "set-cookie": Schema.optionalKey(Schema.String) };
const DevSessionWithCookie = HttpApiSchema.WithHeaders(DevSession, CookieHeaders);
const SessionWithCookie = HttpApiSchema.WithHeaders(Session, CookieHeaders);
const SignedOut = HttpApiSchema.WithHeaders(HttpApiSchema.NoContent, CookieHeaders);

export const AuthHttp = HttpApiGroup.make("auth").add(
  HttpApiEndpoint.post("start", "/auth/start", {
    payload: Schema.Struct({ email: Schema.String }),
    success: [DevSessionWithCookie, HttpApiSchema.NoContent],
    error: [BadRequestError, RateLimitedError, InternalErrorSchema],
  }),
  HttpApiEndpoint.post("verify", "/auth/verify", {
    payload: Schema.Struct({
      email: Schema.String,
      code: Schema.String,
      displayName: Schema.optionalKey(Schema.String),
    }),
    success: SessionWithCookie,
    error: [BadRequestError, InternalErrorSchema],
  }),
  HttpApiEndpoint.post("signout", "/auth/signout", { success: SignedOut }),
  HttpApiEndpoint.get("me", "/auth/me", {
    success: Schema.Struct({ user: PublicUser }),
    error: UnauthenticatedError,
  }).middleware(Authentication),
  HttpApiEndpoint.post("passwordLogin", "/auth/password", {
    payload: Schema.Struct({ email: Schema.String, password: Schema.String }),
    success: SessionWithCookie,
    error: [BadRequestError, RateLimitedError, InternalErrorSchema],
  }),
  HttpApiEndpoint.put("setPassword", "/me/password", {
    payload: Schema.Struct({
      password: Schema.String,
      currentPassword: Schema.optionalKey(Schema.String),
    }),
    error: [BadRequestError, UnauthenticatedError, ForbiddenError],
  }).middleware(Authentication),
  HttpApiEndpoint.delete("removePassword", "/me/password", {
    payload: Schema.Struct({ currentPassword: Schema.String }),
    error: [BadRequestError, UnauthenticatedError, ForbiddenError],
  }).middleware(Authentication),
  HttpApiEndpoint.post("passkeyRegistrationOptions", "/auth/passkey/register/options", {
    success: JsonObject,
    error: UnauthenticatedError,
  }).middleware(Authentication),
  HttpApiEndpoint.post("verifyPasskeyRegistration", "/auth/passkey/register/verify", {
    payload: Schema.Struct({
      response: RegistrationResponse,
      label: Schema.optionalKey(Schema.String),
    }),
    success: Schema.Struct({ ok: Schema.Literal(true) }),
    error: [BadRequestError, UnauthenticatedError],
  }).middleware(Authentication),
  HttpApiEndpoint.post("passkeyLoginOptions", "/auth/passkey/login/options", {
    payload: Schema.Struct({ email: Schema.String }),
    success: JsonObject,
    error: [BadRequestError, NotFoundError, InternalErrorSchema],
  }),
  HttpApiEndpoint.post("verifyPasskeyLogin", "/auth/passkey/login/verify", {
    payload: Schema.Struct({ response: AuthenticationResponse }),
    success: Session,
    error: [BadRequestError, InternalErrorSchema],
  }),
  HttpApiEndpoint.get("passkeys", "/me/passkeys", {
    success: Schema.Struct({ passkeys: Schema.Array(PasskeyInfo), hasPassword: Schema.Boolean }),
    error: UnauthenticatedError,
  }).middleware(Authentication),
  HttpApiEndpoint.delete("removePasskey", "/me/passkeys/:id", {
    params: { id: Schema.String },
    error: [UnauthenticatedError, NotFoundError],
  }).middleware(Authentication),
);
