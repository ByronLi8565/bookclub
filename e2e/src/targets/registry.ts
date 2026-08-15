import type { Target } from "../target.ts";
import { wranglerTarget } from "./wrangler.ts";

const TARGETS = new Map<string, () => Target>([["wrangler", wranglerTarget]]);

export function resolveTarget(): Target {
  const name = process.env.E2E_TARGET ?? "wrangler";
  const factory = TARGETS.get(name);
  if (!factory) {
    throw new Error(
      `Unknown E2E_TARGET "${name}". Known targets: ${[...TARGETS.keys()].join(", ")}.`,
    );
  }
  return factory();
}
