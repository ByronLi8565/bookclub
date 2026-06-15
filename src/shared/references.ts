const REFERENCE_SOURCE = "\\[\\[(\\d+)\\]\\]";

export const REFERENCE_PATTERN = new RegExp(REFERENCE_SOURCE, "gu");
export const REFERENCE_IMPORT = new RegExp(REFERENCE_SOURCE, "u");
export const REFERENCE_TYPING = new RegExp(`${REFERENCE_SOURCE}$`, "u");

export function extractReferences(body: string): number[] {
  const seqs: number[] = [];
  for (const match of body.matchAll(REFERENCE_PATTERN)) {
    seqs.push(Number(match[1]));
  }
  return seqs;
}
