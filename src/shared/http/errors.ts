import { Schema } from "effect";
import { HttpApiSchema } from "effect/unstable/httpapi";
import { ApiErrorReasonSchema, ApiErrorSchema } from "../types/errors.ts";

const fields = { error: ApiErrorSchema, reason: Schema.optionalKey(ApiErrorReasonSchema) };

export class BadRequest extends Schema.TaggedError<BadRequest>()("BadRequest", fields) {}
export class Unauthenticated extends Schema.TaggedError<Unauthenticated>()(
  "Unauthenticated",
  fields,
) {}
export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", fields) {}
export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", fields) {}
export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", fields) {}
export class TooLarge extends Schema.TaggedError<TooLarge>()("TooLarge", fields) {}
export class RateLimited extends Schema.TaggedError<RateLimited>()("RateLimited", fields) {}
export class InternalError extends Schema.TaggedError<InternalError>()("InternalError", fields) {}
export class ServiceUnavailable extends Schema.TaggedError<ServiceUnavailable>()(
  "ServiceUnavailable",
  fields,
) {}

export type ApiFailure =
  | BadRequest
  | Unauthenticated
  | Forbidden
  | NotFound
  | Conflict
  | TooLarge
  | RateLimited
  | InternalError
  | ServiceUnavailable;

export const FAILURE_STATUS = {
  BadRequest: 400,
  Unauthenticated: 401,
  Forbidden: 403,
  NotFound: 404,
  Conflict: 409,
  TooLarge: 413,
  RateLimited: 429,
  InternalError: 500,
  ServiceUnavailable: 503,
} as const satisfies Record<ApiFailure["_tag"], number>;

export const BadRequestError = BadRequest.pipe(HttpApiSchema.status(FAILURE_STATUS.BadRequest));
export const UnauthenticatedError = Unauthenticated.pipe(
  HttpApiSchema.status(FAILURE_STATUS.Unauthenticated),
);
export const ForbiddenError = Forbidden.pipe(HttpApiSchema.status(FAILURE_STATUS.Forbidden));
export const NotFoundError = NotFound.pipe(HttpApiSchema.status(FAILURE_STATUS.NotFound));
export const ConflictError = Conflict.pipe(HttpApiSchema.status(FAILURE_STATUS.Conflict));
export const TooLargeError = TooLarge.pipe(HttpApiSchema.status(FAILURE_STATUS.TooLarge));
export const RateLimitedError = RateLimited.pipe(HttpApiSchema.status(FAILURE_STATUS.RateLimited));
export const InternalErrorSchema = InternalError.pipe(
  HttpApiSchema.status(FAILURE_STATUS.InternalError),
);
export const ServiceUnavailableError = ServiceUnavailable.pipe(
  HttpApiSchema.status(FAILURE_STATUS.ServiceUnavailable),
);
