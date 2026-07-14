import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { apiFetch } from "./api.ts";

export class ApiRequestError extends Schema.TaggedErrorClass<ApiRequestError>()(
  "Api.RequestError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export const request = Effect.fn("Api.request")(function* (
  operation: string,
  path: string,
  init?: RequestInit,
): Effect.fn.Return<Response, ApiRequestError> {
  const response = yield* Effect.tryPromise({
    try: (signal) => apiFetch(path, { ...init, signal }),
    catch: (cause) => new ApiRequestError({ operation, cause }),
  });
  if (!response.ok) {
    return yield* Effect.fail(
      new ApiRequestError({ operation, cause: new Error(`http_${response.status}`) }),
    );
  }
  return response;
});

export const decodeJson = Effect.fn("Api.decodeJson")(function* <S extends Schema.Decoder<unknown>>(
  operation: string,
  response: Response,
  schema: S,
): Effect.fn.Return<S["Type"], ApiRequestError> {
  const json = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) => new ApiRequestError({ operation, cause }),
  });
  return yield* Schema.decodeUnknownEffect(schema)(json).pipe(
    Effect.mapError((cause) => new ApiRequestError({ operation, cause })),
  );
});
