import type { Target } from "../target.ts";
import { targetBaseUrl } from "../ports.ts";

export function wranglerTarget(): Target {
  return {
    name: "wrangler",
    baseUrl: targetBaseUrl("wrangler"),
    capabilities: new Set(["api", "notes", "auth"]),
  };
}
