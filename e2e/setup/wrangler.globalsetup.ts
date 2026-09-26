import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startWorker } from "../src/worker.ts";

export default async function setup(): Promise<() => void> {
  // Results from renamed or deleted scenarios must not linger looking green.
  rmSync(fileURLToPath(new URL("../runs/wrangler/", import.meta.url)), {
    recursive: true,
    force: true,
  });
  const worker = await startWorker("wrangler");
  return () => worker.stop();
}
