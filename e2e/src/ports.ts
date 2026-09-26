import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

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

export function targetBaseUrl(target: string): string {
  const attached = process.env[`E2E_${target.toUpperCase()}_URL`];
  if (attached) return attached.replace(/\/$/u, "");
  // `localhost` rather than 127.0.0.1: cookie jars treat it as secure, so the
  // worker's Secure session cookie survives plain http.
  return `http://localhost:${targetPort(target)}`;
}

export function shouldBoot(target: string): boolean {
  return !process.env[`E2E_${target.toUpperCase()}_URL`];
}
