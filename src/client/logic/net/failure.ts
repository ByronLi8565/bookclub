/**
 * Why a request did not answer.
 *
 * The distinction that matters to a reader is whether the server said no or
 * never spoke at all. A "no" is authoritative and replaces whatever this device
 * remembers; silence falls back to it. Collapsing the two is what makes an app
 * sign you out when you walk into a tunnel.
 */
export type ApiFailure = "notfound" | "unreachable" | "refused";

const tagOf = (error: unknown): string | null =>
  typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"
    ? error._tag
    : null;

const reasonOf = (error: unknown): string | null =>
  typeof error === "object" &&
  error !== null &&
  "reason" in error &&
  typeof error.reason === "string"
    ? error.reason
    : null;

const statusOf = (error: unknown): number | null => {
  if (typeof error !== "object" || error === null || !("response" in error)) return null;
  const { response } = error;
  return typeof response === "object" &&
    response !== null &&
    "status" in response &&
    typeof response.status === "number"
    ? response.status
    : null;
};

/**
 * A typed error from the API contract carries its own tag; a transport failure
 * carries none because no response was ever decoded. Both shapes are read here
 * rather than at each call site, so a client upgrade that changes one of them
 * has a single place to break.
 */
export const apiFailure = (error: unknown): ApiFailure => {
  switch (tagOf(error)) {
    case "NotFound":
      return "notfound";
    case "RequestError":
      return "unreachable";
    default:
      break;
  }
  // An `HttpClientError` names why it failed; "Transport" is the one that means
  // the request never reached anybody.
  if (reasonOf(error) === "Transport") return "unreachable";
  const status = statusOf(error);
  if (status === 404) return "notfound";
  if (status === null) return "unreachable";
  return "refused";
};
