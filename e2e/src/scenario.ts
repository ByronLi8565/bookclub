import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it, type TestContext } from "vitest";
import type { Capability, Target } from "./target.ts";
import { resolveTarget } from "./targets/registry.ts";
import { makeApiSurface, type ApiSurface } from "./surfaces/api.ts";
import { makeNotesSurface, type NotesSurface } from "./surfaces/notes.ts";
import { makeAuthSurface, type AuthSurface } from "./surfaces/auth.ts";

// scenario(): the one way an e2e test is written. Modelled on executor's
// scenario() — the body declares what it needs by asking the context for
// surfaces; asking for one the current target can't provide skips the test and
// records why, instead of failing. Each run writes a small result.json under
// runs/<target>/<slug>/ so a pass/fail matrix can be assembled later. The test
// name should read like a product guarantee, and the body like a spec.

export const RUNS_DIR = fileURLToPath(new URL("../runs/", import.meta.url));

interface SurfaceMap {
  api: ApiSurface;
  notes: NotesSurface;
  auth: AuthSurface;
}

export interface ScenarioContext {
  readonly target: Target;
  /** This run's artifact directory. */
  readonly runDir: string;
  /** Get a surface, or skip the scenario if this target can't provide it. */
  need<K extends Capability>(capability: K): SurfaceMap[K];
  /** Register a finalizer (runs on success OR failure), like Effect.ensuring. */
  onCleanup(fn: () => unknown | Promise<unknown>): void;
}

export interface ScenarioOptions {
  readonly timeout?: number;
  /** Register as skipped without running — only for a tracked, out-of-scope gap. */
  readonly skip?: string;
}

class SkipSignal extends Error {
  constructor(readonly capability: Capability) {
    super(`needs ${capability}`);
  }
}

export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 80);

function makeContext(
  target: Target,
  runDir: string,
  cleanups: Array<() => unknown>,
): ScenarioContext {
  const cache = new Map<Capability, unknown>();
  const build: { [K in Capability]: () => SurfaceMap[K] } = {
    api: () => makeApiSurface(target.baseUrl),
    notes: () => makeNotesSurface(target.baseUrl),
    auth: () => makeAuthSurface(target.baseUrl),
  };
  return {
    target,
    runDir,
    need(capability) {
      if (!target.capabilities.has(capability)) throw new SkipSignal(capability);
      if (!cache.has(capability)) cache.set(capability, build[capability]());
      return cache.get(capability) as SurfaceMap[typeof capability];
    },
    onCleanup(fn) {
      cleanups.push(fn);
    },
  };
}

async function runCleanups(cleanups: Array<() => unknown>): Promise<void> {
  // Reverse order (LIFO), and never let a finalizer failure mask the result.
  for (const fn of cleanups.toReversed()) {
    try {
      await fn();
    } catch {
      // best-effort teardown
    }
  }
}

function writeResult(dir: string, data: Record<string, unknown>): void {
  writeFileSync(join(dir, "result.json"), JSON.stringify(data, null, 1));
}

export function scenario(
  name: string,
  options: ScenarioOptions,
  body: (ctx: ScenarioContext) => Promise<void>,
): void {
  if (options.skip) {
    it.skip(name, () => {});
    return;
  }

  it(name, { timeout: options.timeout ?? 120_000 }, async (testCtx: TestContext) => {
    const target = resolveTarget();
    const dir = join(RUNS_DIR, target.name, slugify(name));
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    const cleanups: Array<() => unknown> = [];
    const ctx = makeContext(target, dir, cleanups);
    const startedAt = Date.now();

    try {
      await body(ctx);
    } catch (error) {
      await runCleanups(cleanups);
      if (error instanceof SkipSignal) {
        writeFileSync(
          join(dir, "skipped.json"),
          JSON.stringify(
            { scenario: name, target: target.name, missing: error.capability },
            null,
            1,
          ),
        );
        return testCtx.skip(`needs ${error.capability} — not on ${target.name}`);
      }
      writeResult(dir, {
        scenario: name,
        target: target.name,
        ok: false,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    await runCleanups(cleanups);
    writeResult(dir, {
      scenario: name,
      target: target.name,
      ok: true,
      durationMs: Date.now() - startedAt,
    });
  });
}
