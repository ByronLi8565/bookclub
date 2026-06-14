import type { Env } from "./env.ts";

// Deliver a login code to the user's inbox.
//
// For now this only logs the code to the worker output: the maintainer reads it
// from the `wrangler dev` log to sign in. Real delivery via the Cloudflare Email
// Service (`env.EMAIL.send`) is wired once the sender domain is onboarded
// (SPF/DKIM/DMARC) — see step-6-plan decision 10 and risk 3. Logging keeps local
// dev unblocked and "user enumeration is not a vuln" (decision 1) so the code is
// safe to surface in dev logs.
export function sendLoginCode(_env: Env, email: string, code: string): Promise<void> {
  console.log(`[auth] login code for ${email}: ${code}`);
  return Promise.resolve();
}
