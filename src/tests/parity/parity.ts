import { expect } from "vitest";
import { signature, type SignatureOptions } from "./domSignature.ts";

export { signature } from "./domSignature.ts";
export type { SignatureOptions } from "./domSignature.ts";
export * from "./render.ts";

/**
 * The assertion the whole parity suite is built on: the Foldkit tree and the
 * React tree describe the same interface. The diff vitest prints is the tree
 * itself, so a failure names the element that drifted.
 */
export const expectParity = (
  react: Element,
  foldkit: Element,
  options: SignatureOptions = {},
): void => {
  expect(signature(foldkit, options)).toBe(signature(react, options));
};
