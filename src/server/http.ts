import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { ApiErrorBody } from "../shared/types/errors.ts";
import type { WorkflowResult } from "./workflows/runtime.ts";

const JsonObject = Schema.Record(Schema.String, Schema.Unknown);

export async function readJson(request: Request) {
  try {
    return Option.getOrNull(Schema.decodeUnknownOption(JsonObject)(await request.json()));
  } catch {
    return null;
  }
}

export function workflowResponse<T>(
  result: WorkflowResult<T>,
  onSuccess: (value: T) => Response,
): Response {
  if (result.ok) return onSuccess(result.value);
  const body: ApiErrorBody =
    result.reason === undefined
      ? { error: result.error }
      : { error: result.error, reason: result.reason };
  return Response.json(body, { status: result.status });
}
