import type { AuthAgent } from "./state/AuthAgent.ts";
import type { GroupAgent } from "./state/GroupAgent.ts";
import type { GroupRegistry } from "./state/GroupRegistry.ts";
import type { NoteAgent } from "./state/NoteAgent.ts";

export interface Env {
  NoteAgent: DurableObjectNamespace<NoteAgent>;
  AuthAgent: DurableObjectNamespace<AuthAgent>;
  GroupAgent: DurableObjectNamespace<GroupAgent>;
  GroupRegistry: DurableObjectNamespace<GroupRegistry>;
  BOOKS: R2Bucket;
  IMAGES: R2Bucket;
  BACKUPS: R2Bucket;
  SESSION_HMAC_SECRET: string;
  DEV_AUTH?: string;
  // Email allowed to trigger manual backup/restore admin endpoints. Empty
  // disables them (scheduled backups still run regardless).
  ADMIN_EMAIL?: string;
  // Bearer token for machine access to the admin backup/prune endpoints
  // (used by the pre-deploy backup step). Empty disables token auth.
  ADMIN_API_TOKEN?: string;
  EMAIL?: SendEmail;
  EMAIL_FROM?: string;
  ASSETS?: Fetcher;
}
