import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { signature, type SignatureOptions } from "./domSignature.ts";

export { signature } from "./domSignature.ts";
export type { SignatureOptions } from "./domSignature.ts";
export * from "./render.ts";

const SIGNATURES = join(dirname(fileURLToPath(import.meta.url)), "signatures");

/**
 * React's rendering of a surface, recorded from the React client on the day it
 * was deleted. These files are the interface the Foldkit client is held to.
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
 * The assertion the whole suite is built on: the Foldkit tree and the React
 * tree describe the same interface. The diff vitest prints is the tree itself,
 * so a failure names the element that drifted.
 */
/** The claim the whole suite is built on: the Foldkit tree still describes the
 *  interface React rendered. The diff vitest prints is the tree itself, so a
 *  failure names the element that drifted. */
export const expectRecordedParity = (
  name: string,
  foldkit: Element,
  options: SignatureOptions = {},
): void => {
  expect(signature(foldkit, options)).toBe(recordedSignature(name));
};
