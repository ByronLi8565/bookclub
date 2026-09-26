import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { signature, type SignatureOptions } from "./domSignature.ts";

export { signature } from "./domSignature.ts";
export type { SignatureOptions } from "./domSignature.ts";
export * from "./render.ts";

const SIGNATURES = join(import.meta.dirname, "signatures");

/** A surface's recorded signature: the interface the client is held to until
 *  it is re-recorded on purpose. */
const pathFor = (name: string): string => join(SIGNATURES, `${name}.txt`);

export const recordedSignature = (name: string): string => {
  try {
    return readFileSync(pathFor(name), "utf8");
  } catch {
    throw new Error(`No recorded signature for "${name}" in ${SIGNATURES}.`);
  }
};

/**
 * The rendered tree still describes the recorded interface. The diff vitest
 * prints is the tree itself, so a failure names the element that drifted.
 *
 * `RECORD_PARITY=1` rewrites the signature from what renders now instead of
 * asserting against it. That blesses whatever is on screen, so the diff of
 * `signatures/` is the review: use it when the interface changed on purpose,
 * never to make a red test go green.
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
