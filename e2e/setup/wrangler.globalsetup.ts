import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { shouldBoot, targetBaseUrl, targetPort } from "../src/ports.ts";

// Boots the `wrangler` target: `wrangler dev` on the e2e-only config
// (wrangler.e2e.jsonc — the one with the SQLite migration, never deployed)
// against a throwaway persist dir, so every run starts from clean DO state.
// Set E2E_WRANGLER_URL to attach to an already-running instance instead (fast
// iteration: `bunx wrangler dev --config wrangler.e2e.jsonc --port <p>` then
// `E2E_WRANGLER_URL=http://127.0.0.1:<p> npm run e2e`).

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BOOT_TIMEOUT_MS = 90_000;

async function waitForReady(baseUrl: string, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    try {
      // Any HTTP response (even 401 from /auth/me) means the worker is serving.
      await fetch(`${baseUrl}/auth/me`);
      return;
    } catch {
      await new Promise((r) => {
        setTimeout(r, 300);
      });
    }
  }
  throw new Error(`wrangler dev did not become ready within ${BOOT_TIMEOUT_MS}ms`);
}

export default async function setup(): Promise<() => void> {
  const baseUrl = targetBaseUrl("wrangler");

  if (!shouldBoot("wrangler")) {
    await waitForReady(baseUrl, Date.now() + 10_000);
    return () => {};
  }

  const port = targetPort("wrangler");
  const persistDir = join(tmpdir(), `bookclub-e2e-wrangler-${port}`);
  rmSync(persistDir, { recursive: true, force: true });

  const logDir = fileURLToPath(new URL("../runs/.wrangler/", import.meta.url));
  mkdirSync(logDir, { recursive: true });
  const logStream = createWriteStream(join(logDir, "dev.log"));

  const child: ChildProcess = spawn(
    "bunx",
    [
      "wrangler",
      "dev",
      "--config",
      "wrangler.e2e.jsonc",
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
      "--persist-to",
      persistDir,
    ],
    { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);

  try {
    await waitForReady(baseUrl, Date.now() + BOOT_TIMEOUT_MS);
  } catch (error) {
    stop(child);
    throw new Error(
      `${(error as Error).message}\nSee e2e/runs/.wrangler/dev.log for wrangler output.`,
      { cause: error },
    );
  }

  return () => {
    stop(child);
    rmSync(persistDir, { recursive: true, force: true });
  };
}

function stop(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    // Kill the whole process group (wrangler spawns workerd children).
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}
