import { startWorker } from "../src/worker.ts";

export default async function setup(): Promise<() => void> {
  const worker = await startWorker("browser");
  return () => worker.stop();
}
