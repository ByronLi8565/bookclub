import type { AuthAgent } from "./AuthAgent.ts";
import type { GroupAgent } from "./GroupAgent.ts";
import type { GroupRegistry } from "./GroupRegistry.ts";
import type { NoteAgent } from "./NoteAgent.ts";

// The worker's runtime bindings. The DO namespaces are declared in
// alchemy.run.ts (deploy) and wrangler.jsonc (dev); `ASSETS` serves the
// Vite-built client and exists only in the deployed worker — in `wrangler dev`
// the client is served by vite. `SESSION_HMAC_SECRET` signs session cookies.
export interface Env {
  NoteAgent: DurableObjectNamespace<NoteAgent>;
  AuthAgent: DurableObjectNamespace<AuthAgent>;
  // Group membership (one instance per groupId) and the global, single-instance
  // name registry that maps URL names to groupIds.
  GroupAgent: DurableObjectNamespace<GroupAgent>;
  GroupRegistry: DurableObjectNamespace<GroupRegistry>;
  // EPUB bytes, keyed by content hash (dedup across groups).
  BOOKS: R2Bucket;
  SESSION_HMAC_SECRET: string;
  // Email sending. `EMAIL` is the Cloudflare send_email binding; `EMAIL_FROM` is
  // the verified sender address. Both are absent in local dev (codes are logged).
  EMAIL?: SendEmail;
  EMAIL_FROM?: string;
  ASSETS?: Fetcher;
}
