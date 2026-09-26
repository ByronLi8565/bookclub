import { Context } from "effect";
import { HttpApiMiddleware } from "effect/unstable/httpapi";
import { ForbiddenError, InternalErrorSchema, UnauthenticatedError } from "./errors.ts";

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

// Every admin refusal is 403, never 401: the pre-deploy backup script treats 403 as "not allowed".
export class Administration extends HttpApiMiddleware.Service<Administration>()(
  "bookclub/http/Administration",
  { error: [ForbiddenError, InternalErrorSchema] },
) {}
