/**
 * The registry's Durable Object name, on its own so that reaching for it costs
 * nothing. `GroupRegistry.ts` pulls in the `agents` runtime, whose
 * `cloudflare:`-scheme imports do not resolve outside a Worker — importing that
 * module just to read a string is what forced `backup.ts` to load it lazily.
 */
export const REGISTRY_ID = "global";
