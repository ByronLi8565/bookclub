import type { AuthAgent } from "./agents/AuthAgent.ts";
import type { GroupAgent } from "./agents/GroupAgent.ts";
import type { GroupRegistry } from "./agents/GroupRegistry.ts";
import type { NoteAgent } from "./agents/NoteAgent.ts";

export interface Env {
  NoteAgent: DurableObjectNamespace<NoteAgent>;
  AuthAgent: DurableObjectNamespace<AuthAgent>;
  GroupAgent: DurableObjectNamespace<GroupAgent>;
  GroupRegistry: DurableObjectNamespace<GroupRegistry>;
  BOOKS: R2Bucket;
  SESSION_HMAC_SECRET: string;
  EMAIL?: SendEmail;
  EMAIL_FROM?: string;
  ASSETS?: Fetcher;
}
