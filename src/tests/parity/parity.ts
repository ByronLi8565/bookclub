import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { signature, type SignatureOptions } from "./domSignature.ts";

export { signature } from "./domSignature.ts";
export type { SignatureOptions } from "./domSignature.ts";
export * from "./render.ts";

const SIGNATURES = join(dirname(fileURLToPath(import.meta.url)), "signatures");

/**
 * React's rendering of a surface, recorded so it outlives React itself. The
 * files are written by `RECORD_PARITY=1 bun run test src/tests/parity` while
 * both clients exist, and are what the Foldkit client is held to afterwards.
 */
const recordingEnabled = process.env.RECORD_PARITY === "1";

const pathFor = (name: string): string => join(SIGNATURES, `${name}.txt`);

export const recordedSignature = (name: string): string => {
  try {
    return readFileSync(pathFor(name), "utf8");
  } catch {
    throw new Error(
      `No recorded signature for "${name}". Record one from the React client with RECORD_PARITY=1.`,
    );
  }
};

/**
 * The assertion the whole suite is built on: the Foldkit tree and the React
 * tree describe the same interface. The diff vitest prints is the tree itself,
 * so a failure names the element that drifted.
 */
export const expectParity = (
  name: string,
  react: Element,
  foldkit: Element,
  options: SignatureOptions = {},
): void => {
  const expected = signature(react, options);
  if (recordingEnabled) {
    mkdirSync(SIGNATURES, { recursive: true });
    writeFileSync(pathFor(name), expected);
  }
  expect(signature(foldkit, options)).toBe(expected);
};

/** The same claim, after React is gone: the Foldkit tree still matches what
 *  React rendered on the day it was removed. */
export const expectRecordedParity = (
  name: string,
  foldkit: Element,
  options: SignatureOptions = {},
): void => {
  expect(signature(foldkit, options)).toBe(recordedSignature(name));
};
