// The `[[n]]` cross-reference syntax, shared verbatim by the editor, the
// read-only renderer, and the server's deletion rule. This module is
// deliberately dependency-free (no Lexical, no DOM) so the worker can import it
// as a value without pulling the editor toolchain into its bundle.

// The one grammar for a reference: a note's human-readable seq wrapped in double
// brackets, e.g. `[[1]]`, with the seq as the capture group. Every surface
// (whole-body scan, markdown import, live typing) derives its regex from this so
// the dialect can't drift.
const REFERENCE_SOURCE = "\\[\\[(\\d+)\\]\\]";

// Global: scans a whole body (matchAll / replaceAll).
export const REFERENCE_PATTERN = new RegExp(REFERENCE_SOURCE, "gu");
// Non-global: a single reference anywhere, for markdown import.
export const REFERENCE_IMPORT = new RegExp(REFERENCE_SOURCE, "u");
// Anchored to the end: fires the live editor shortcut as the closing `]]` lands.
export const REFERENCE_TYPING = new RegExp(`${REFERENCE_SOURCE}$`, "u");

// Every seq referenced by a body, in order of appearance (duplicates kept).
export function extractReferences(body: string): number[] {
  const seqs: number[] = [];
  for (const match of body.matchAll(REFERENCE_PATTERN)) {
    seqs.push(Number(match[1]));
  }
  return seqs;
}
