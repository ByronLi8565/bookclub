import { spawn } from "node:child_process";
import { startWorker, type RunningWorker } from "../e2e/src/worker.ts";

// The whole gate in one command. Static checks, unit tests, and the worker boot
// share no state, so they start together; the worker scenarios and browser
// journeys then share that one fresh worker, which is safe because every test
// mints its own identities.

interface Stage {
  readonly name: string;
  readonly ok: boolean;
  readonly seconds: number;
  readonly output: string;
}

const started = Date.now();
const elapsed = (since: number) => (Date.now() - since) / 1000;

function run(name: string, command: string, env: Record<string, string> = {}): Promise<Stage> {
  const since = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      env: { ...process.env, ...env, FORCE_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => {
      const stage = { name, ok: code === 0, seconds: elapsed(since), output };
      report(stage);
      resolve(stage);
    });
  });
}

function report(stage: Stage): void {
  if (!stage.ok) process.stdout.write(`\n── ${stage.name} output ──\n${stage.output}\n`);
  console.log(`${stage.ok ? "✓" : "✗"} ${stage.name} (${stage.seconds.toFixed(1)}s)`);
}

async function boot(): Promise<{ stage: Stage; worker: RunningWorker | null }> {
  const since = Date.now();
  try {
    const worker = await startWorker("browser");
    const stage = { name: "build + boot worker", ok: true, seconds: elapsed(since), output: "" };
    report(stage);
    return { stage, worker };
  } catch (error) {
    const stage = {
      name: "build + boot worker",
      ok: false,
      seconds: elapsed(since),
      output: String(error),
    };
    report(stage);
    return { stage, worker: null };
  }
}

const [check, unit, booted] = await Promise.all([
  run("format, lint, typecheck", "bun run check"),
  run("unit", "bunx vitest run"),
  boot(),
]);

const stages = [check, unit, booted.stage];
if (booted.worker) {
  const shared = {
    E2E_WRANGLER_URL: booted.worker.baseUrl,
    E2E_BROWSER_URL: booted.worker.baseUrl,
  };
  try {
    stages.push(
      ...(await Promise.all([
        run("worker scenarios", "bunx vitest run --config e2e/vitest.config.ts", shared),
        run("browser journeys", "bunx playwright test", shared),
      ])),
    );
  } finally {
    booted.worker.stop();
  }
}

const failed = stages.filter((stage) => !stage.ok);
console.log(
  failed.length === 0
    ? `\nAll green in ${elapsed(started).toFixed(1)}s`
    : `\n${failed.length} stage(s) failed: ${failed.map((stage) => stage.name).join(", ")}`,
);
process.exit(failed.length === 0 ? 0 : 1);
