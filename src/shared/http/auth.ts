import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";
import { PasskeyInfo } from "../types/passkeys.ts";
import { JsonObject, PublicUser, Session } from "./compatibility.ts";
import { AuthenticationResponse, RegistrationResponse } from "./webauthn.ts";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
} from "./errors.ts";

const DevSession = Schema.Struct({
  devSignedIn: Schema.Literal(true),
  user: PublicUser,
  token: Schema.String,
}).pipe(HttpApiSchema.status(200));

export const AuthHttp = HttpApiGroup.make("auth").add(
  HttpApiEndpoint.post("start", "/auth/start", {
    payload: Schema.Struct({ email: Schema.String }),
    success: [DevSession, HttpApiSchema.NoContent],
    error: [BadRequestError, RateLimitedError],
  }),
  HttpApiEndpoint.post("verify", "/auth/verify", {
    payload: Schema.Struct({
      email: Schema.String,
      code: Schema.String,
      displayName: Schema.optionalKey(Schema.String),
    }),
    success: Session,
    error: BadRequestError,
  }),
  HttpApiEndpoint.post("signout", "/auth/signout"),
  HttpApiEndpoint.get("me", "/auth/me", {
    success: Schema.Struct({ user: PublicUser }),
    error: UnauthenticatedError,
  }),
  HttpApiEndpoint.post("passwordLogin", "/auth/password", {
    payload: Schema.Struct({ email: Schema.String, password: Schema.String }),
    success: Session,
    error: [BadRequestError, RateLimitedError],
  }),
  HttpApiEndpoint.put("setPassword", "/me/password", {
    payload: Schema.Struct({
      password: Schema.String,
      currentPassword: Schema.optionalKey(Schema.String),
    }),
    error: [BadRequestError, UnauthenticatedError, ForbiddenError],
  }),
  HttpApiEndpoint.delete("removePassword", "/me/password", {
    payload: Schema.Struct({ currentPassword: Schema.String }),
    error: [BadRequestError, UnauthenticatedError, ForbiddenError],
  }),
  HttpApiEndpoint.post("passkeyRegistrationOptions", "/auth/passkey/register/options", {
    success: JsonObject,
    error: UnauthenticatedError,
  }),
  HttpApiEndpoint.post("verifyPasskeyRegistration", "/auth/passkey/register/verify", {
    payload: Schema.Struct({
      response: RegistrationResponse,
      label: Schema.optionalKey(Schema.String),
    }),
    success: Schema.Struct({ ok: Schema.Literal(true) }),
    error: [BadRequestError, UnauthenticatedError],
  }),
  HttpApiEndpoint.post("passkeyLoginOptions", "/auth/passkey/login/options", {
    payload: Schema.Struct({ email: Schema.String }),
    success: JsonObject,
    error: [BadRequestError, NotFoundError],
  }),
  HttpApiEndpoint.post("verifyPasskeyLogin", "/auth/passkey/login/verify", {
    payload: Schema.Struct({ response: AuthenticationResponse }),
    success: Session,
    error: BadRequestError,
  }),
  HttpApiEndpoint.get("passkeys", "/me/passkeys", {
    success: Schema.Struct({ passkeys: Schema.Array(PasskeyInfo), hasPassword: Schema.Boolean }),
    error: UnauthenticatedError,
  }),
  HttpApiEndpoint.delete("removePasskey", "/me/passkeys/:id", {
    params: { id: Schema.String },
    error: [UnauthenticatedError, NotFoundError],
  }),
);
