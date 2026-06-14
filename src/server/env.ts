import type { AuthAgent } from "./AuthAgent.ts";
import type { NoteAgent } from "./NoteAgent.ts";

// The worker's runtime bindings. The DO namespaces are declared in
// alchemy.run.ts (deploy) and wrangler.jsonc (dev); `ASSETS` serves the
// Vite-built client and exists only in the deployed worker — in `wrangler dev`
// the client is served by vite. `SESSION_HMAC_SECRET` signs session cookies.
export interface Env {
  NoteAgent: DurableObjectNamespace<NoteAgent>;
  AuthAgent: DurableObjectNamespace<AuthAgent>;
  SESSION_HMAC_SECRET: string;
  ASSETS?: Fetcher;
}
