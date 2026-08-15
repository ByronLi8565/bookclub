import { Context } from "effect";
import { HttpApiMiddleware } from "effect/unstable/httpapi";
import { InternalErrorSchema, UnauthenticatedError } from "./errors.ts";

export interface Identity {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export class CurrentIdentity extends Context.Service<CurrentIdentity, Identity>()(
  "bookclub/http/CurrentIdentity",
) {}

export class Authentication extends HttpApiMiddleware.Service<
  Authentication,
  { provides: CurrentIdentity }
>()("bookclub/http/Authentication", { error: [UnauthenticatedError, InternalErrorSchema] }) {}
