import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { shouldBoot, targetBaseUrl, targetPort } from "./ports.ts";

// Boots the product exactly as a user meets it: the production client bundle
// served by the worker under `wrangler dev` on the e2e-only config
// (wrangler.e2e.jsonc — isolated SQLite exports, never deployed), against a
// throwaway persist dir so every run starts from clean state. Set
// E2E_<TARGET>_URL to attach to an already-running instance instead.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const LOG_DIR = fileURLToPath(new URL("../runs/.wrangler/", import.meta.url));
const BOOT_TIMEOUT_MS = 90_000;

export interface RunningWorker {
  readonly baseUrl: string;
  stop(): void;
}

export async function startWorker(target: string): Promise<RunningWorker> {
  const baseUrl = targetBaseUrl(target);
  if (!shouldBoot(target)) {
    await waitForReady(baseUrl, Date.now() + 10_000);
    return { baseUrl, stop: () => {} };
  }

  buildClient();
  const persistDir = mkdtempSync(join(tmpdir(), `bookclub-e2e-${target}-`));
  mkdirSync(LOG_DIR, { recursive: true });
  const logPath = join(LOG_DIR, `${target}.log`);
  const log = createWriteStream(logPath);
  const child = spawn(
    "bunx",
    [
      "wrangler",
      "dev",
      "--config",
      "wrangler.e2e.jsonc",
      "--port",
      String(targetPort(target)),
      "--ip",
      "127.0.0.1",
      "--persist-to",
      persistDir,
    ],
    { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  const stop = () => {
    kill(child);
    rmSync(persistDir, { recursive: true, force: true });
  };

  try {
    await waitForReady(baseUrl, Date.now() + BOOT_TIMEOUT_MS);
  } catch (error) {
    stop();
    throw new Error(`${String(error)}\nSee ${logPath} for wrangler output.`, { cause: error });
  }
  return { baseUrl, stop };
}

// The worker serves dist/client, so the bundle must match the checkout under test.
function buildClient(): void {
  const build = spawnSync("bunx", ["vite", "build", "--logLevel", "error"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (build.status !== 0) throw new Error("vite build failed; the e2e worker has nothing to serve");
}

async function waitForReady(baseUrl: string, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    try {
      // Any HTTP response (even 401 from /auth/me) means the worker is serving.
      await fetch(`${baseUrl}/auth/me`, { signal: AbortSignal.timeout(2_000) });
      return;
    } catch {
      await new Promise((resolve) => {
        setTimeout(resolve, 300);
      });
    }
  }
  throw new Error(`wrangler dev at ${baseUrl} did not become ready within ${BOOT_TIMEOUT_MS}ms`);
}

function kill(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    // Kill the whole process group (wrangler spawns workerd children).
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}
