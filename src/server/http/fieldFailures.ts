import { Effect, SchemaIssue } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { HttpApiSchemaError } from "effect/unstable/httpapi/HttpApiError";
import { type ApiFailure, FAILURE_STATUS } from "../../shared/http/errors.ts";
import { FAILURE_ANNOTATION } from "../../shared/http/fields.ts";

/** The failure a field's parse named for itself, wherever it sits in the issue tree. */
const annotatedFailure = (issue: SchemaIssue.Issue): ApiFailure | undefined => {
  if (issue instanceof SchemaIssue.InvalidValue) {
    // SAFETY: only fields.ts writes this annotation, and it always holds an ApiFailure.
    return issue.annotations?.[FAILURE_ANNOTATION] as ApiFailure | undefined;
  }
  const nested: ReadonlyArray<SchemaIssue.Issue> =
    "issues" in issue ? issue.issues : "issue" in issue ? [issue.issue] : [];
  for (const child of nested) {
    const failure = annotatedFailure(child);
    if (failure) return failure;
  }
  return undefined;
};

const failureResponse = ({ _tag, error, reason }: ApiFailure) =>
  HttpServerResponse.jsonUnsafe(reason === undefined ? { _tag, error } : { _tag, error, reason }, {
    status: FAILURE_STATUS[_tag],
  });

/** A malformed field answers with the status and `error` code its endpoint documents,
 *  rather than the bare 400 a decode failure otherwise renders as. HttpApi raises
 *  decode failures as defects, so that is where this looks for them. */
export const FieldFailuresLayer = HttpRouter.middleware(
  (httpEffect) =>
    Effect.catchDefect(httpEffect, (defect) => {
      const failure = HttpApiSchemaError.is(defect)
        ? annotatedFailure(defect.cause.issue)
        : undefined;
      return failure ? Effect.succeed(failureResponse(failure)) : Effect.die(defect);
    }),
  { global: true },
);
