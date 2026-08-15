import { defineConfig } from "vitest/config";

const ROOT = import.meta.dirname;

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
