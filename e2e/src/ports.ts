import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// Deterministic, collision-avoiding ports — the same idea as executor's
// e2e/src/ports.ts, scaled down to what this project needs. Both the
// globalSetup (which boots the server) and the scenarios (which connect to it)
// derive the SAME port from the checkout's repo root, with no IPC between them.
// A second worktree hashes to a different block, so two suites can run at once
// without stepping on each other. `E2E_<TARGET>_PORT` pins the port explicitly;
// `E2E_<TARGET>_URL` attaches to an already-running instance instead of booting.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

// A block well clear of the app's own dev ports (vite 5173, wrangler 8787).
const PORT_BASE = 8800;
const PORT_SPAN = 100;

function derivePort(target: string): number {
  const digest = createHash("sha256").update(`${REPO_ROOT}:${target}`).digest();
  return PORT_BASE + (digest.readUInt16BE(0) % PORT_SPAN);
}

export function targetPort(target: string): number {
  const pinned = process.env[`E2E_${target.toUpperCase()}_PORT`];
  if (pinned) return Number(pinned);
  return derivePort(target);
}

/** The base URL scenarios talk to: an attached instance if `E2E_<TARGET>_URL`
 *  is set, otherwise the locally-booted server on the derived port. */
export function targetBaseUrl(target: string): string {
  const attached = process.env[`E2E_${target.toUpperCase()}_URL`];
  if (attached) return attached.replace(/\/$/u, "");
  return `http://127.0.0.1:${targetPort(target)}`;
}

/** Whether the suite should boot its own server (false when attaching). */
export function shouldBoot(target: string): boolean {
  return !process.env[`E2E_${target.toUpperCase()}_URL`];
}
