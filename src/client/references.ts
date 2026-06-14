// The `[[n]]` cross-reference syntax, shared verbatim by the editor, the
// read-only renderer, and the server's deletion rule. This module is
// deliberately dependency-free (no Lexical, no DOM) so the worker can import it
// as a value without pulling the editor toolchain into its bundle.

// A reference is a note's human-readable seq wrapped in double brackets, e.g.
// `[[1]]`. The capture group is the referenced seq.
export const REFERENCE_PATTERN = /\[\[(\d+)\]\]/gu;

// Every seq referenced by a body, in order of appearance (duplicates kept).
export function extractReferences(body: string): number[] {
  const seqs: number[] = [];
  for (const match of body.matchAll(REFERENCE_PATTERN)) {
    seqs.push(Number(match[1]));
  }
  return seqs;
}
