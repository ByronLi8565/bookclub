import * as Effect from "effect/Effect";
import { HashError } from "../errors.ts";

// Content-address a candidate file: sha256(bytes) -> Source id.
export const hashFile = (file: Blob): Effect.Effect<string, HashError> =>
  Effect.tryPromise({
    try: async () => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        await file.arrayBuffer(),
      );
      return [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    },
    catch: (cause) => new HashError({ cause }),
  });
