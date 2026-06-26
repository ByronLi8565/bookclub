/** Increment a sequence ref, used to invalidate in-flight async render/measure work. */
export function bumpSeq(ref: { current: number }): void {
  ref.current += 1;
}
