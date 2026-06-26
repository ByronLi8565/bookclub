// Extract an `{ error }` message from a failed response body, falling back to a
// synthetic `http_<status>` code when the body is missing or not JSON.
export async function parseHttpError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `http_${response.status}`;
  } catch {
    return `http_${response.status}`;
  }
}
