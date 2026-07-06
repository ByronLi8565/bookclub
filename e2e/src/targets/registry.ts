import type { Target } from "../target.ts";
import { wranglerTarget } from "./wrangler.ts";

// Resolve the target under test from E2E_TARGET (set per vitest project in
// e2e/vitest.config.ts). New deployment forms get a factory here; scenarios and
// surfaces never name a target directly.
const TARGETS: Record<string, () => Target> = { wrangler: wranglerTarget };

export function resolveTarget(): Target {
  const name = process.env.E2E_TARGET ?? "wrangler";
  const factory = TARGETS[name];
  if (!factory) {
    throw new Error(
      `Unknown E2E_TARGET "${name}". Known targets: ${Object.keys(TARGETS).join(", ")}.`,
    );
  }
  return factory();
}
