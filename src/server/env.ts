import type { NoteAgent } from "./NoteAgent.ts";

// The worker's runtime bindings. `NoteAgent` is the durable object namespace
// declared in alchemy.run.ts; `ASSETS` serves the Vite-built client.
export interface Env {
  NoteAgent: DurableObjectNamespace<NoteAgent>;
  ASSETS: Fetcher;
}
