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

export const BadRequestError = BadRequest.pipe(HttpApiSchema.status(400));
export const UnauthenticatedError = Unauthenticated.pipe(HttpApiSchema.status(401));
export const ForbiddenError = Forbidden.pipe(HttpApiSchema.status(403));
export const NotFoundError = NotFound.pipe(HttpApiSchema.status(404));
export const ConflictError = Conflict.pipe(HttpApiSchema.status(409));
export const TooLargeError = TooLarge.pipe(HttpApiSchema.status(413));
export const RateLimitedError = RateLimited.pipe(HttpApiSchema.status(429));
export const InternalErrorSchema = InternalError.pipe(HttpApiSchema.status(500));
export const ServiceUnavailableError = ServiceUnavailable.pipe(HttpApiSchema.status(503));

export const WorkflowErrors = [
  BadRequestError,
  UnauthenticatedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  TooLargeError,
  RateLimitedError,
  InternalErrorSchema,
  ServiceUnavailableError,
] as const;
