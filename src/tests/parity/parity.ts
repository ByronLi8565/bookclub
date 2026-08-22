import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { signature, type SignatureOptions } from "./domSignature.ts";

export { signature } from "./domSignature.ts";
export type { SignatureOptions } from "./domSignature.ts";
export * from "./render.ts";

const SIGNATURES = join(dirname(fileURLToPath(import.meta.url)), "signatures");

/**
 * A surface's recorded signature. These began as React's rendering, captured on
 * the day it was deleted, and remain the interface the Foldkit client is held
 * to until one is re-recorded on purpose.
 */
const pathFor = (name: string): string => join(SIGNATURES, `${name}.txt`);

export const recordedSignature = (name: string): string => {
  try {
    return readFileSync(pathFor(name), "utf8");
  } catch {
    throw new Error(`No recorded signature for "${name}" in ${SIGNATURES}.`);
  }
};

/**
 * The claim the whole suite is built on: the Foldkit tree still describes the
 * interface React rendered. The diff vitest prints is the tree itself, so a
 * failure names the element that drifted.
 *
 * `RECORD_PARITY=1` rewrites the signature from what Foldkit renders now
 * instead of asserting against it. React is gone, so this is the only way to
 * move a baseline — which makes it a deliberate act: it blesses whatever is on
 * screen, and the git diff of `signatures/` is the review. Use it when the
 * interface changed on purpose, never to make a red test go green.
 */
export const expectRecordedParity = (
  name: string,
  foldkit: Element,
  options: SignatureOptions = {},
): void => {
  const current = signature(foldkit, options);
  if (process.env.RECORD_PARITY === "1") {
    writeFileSync(pathFor(name), current, "utf8");
    return;
  }
  expect(current).toBe(recordedSignature(name));
};
