import type { Target } from "../target.ts";
import { targetBaseUrl } from "../ports.ts";

// The `wrangler` target: the real worker (Durable Objects, auth, the NoteAgent
// websocket) running under `wrangler dev` against a throwaway local persist dir.
// This is the closest analogue to executor's `selfhost-docker` target — it
// exercises the same artifact the product actually is, not a mock.
export function wranglerTarget(): Target {
  return {
    name: "wrangler",
    baseUrl: targetBaseUrl("wrangler"),
    capabilities: new Set(["api", "notes", "auth"]),
  };
}
