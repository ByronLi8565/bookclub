import type { NoteAgent } from "./NoteAgent.ts";

// The worker's runtime bindings. `NoteAgent` is the durable object namespace
// declared in alchemy.run.ts; `ASSETS` serves the Vite-built client and exists
// only in the deployed worker — in `wrangler dev` the client is served by vite.
export interface Env {
  NoteAgent: DurableObjectNamespace<NoteAgent>;
  ASSETS?: Fetcher;
}
