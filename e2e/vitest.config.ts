import { defineConfig } from "vitest/config";

// The suite's root is this directory, regardless of the cwd `--config` is run
// from, so scenario/globalSetup globs resolve consistently.
const ROOT = import.meta.dirname;

// One project per target — the same scenario files, run against a different
// running deployment. Today there is one working target (`wrangler`, the built
// worker); the shape mirrors executor's e2e config so a second target is a new
// project entry, not a rewrite. Each project's globalSetup boots that target's
// server (or attaches to E2E_<TARGET>_URL).
const project = (name: string, overrides: Record<string, unknown> = {}) => ({
  test: {
    name,
    include: ["scenarios/**/*.test.ts", `${name}/**/*.test.ts`],
    env: { E2E_TARGET: name },
    globalSetup: [`./setup/${name}.globalsetup.ts`],
    // Scenarios boot real servers and open sockets — keep them serial and give
    // the worker room to answer.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    ...overrides,
  },
});

export default defineConfig({ test: { root: ROOT, projects: [project("wrangler")] } });
