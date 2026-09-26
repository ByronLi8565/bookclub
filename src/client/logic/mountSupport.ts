import { Effect } from "effect";

/** Resolves after the next two animation frames: the first runs before the
 *  pending DOM patch has been laid out, so the second is the earliest point
 *  at which measured sizes describe it. */
export const nextFrames = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

/**
 * Calls `run` once the page returns to the foreground and has laid out again.
 * A mobile browser can restore a backgrounded page (or one from the
 * back/forward cache) with a stale viewport, so readers relayout from here.
 * Only the latest resume runs, and none runs after the returned disposer.
 */
export function onForegroundResume(run: () => void): () => void {
  let generation = 0;
  const resume = () => {
    if (document.visibilityState !== "visible") return;
    const current = ++generation;
    void nextFrames().then(() => {
      if (current === generation) run();
    });
  };
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("pageshow", resume);
  return () => {
    generation += 1;
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("pageshow", resume);
  };
}

/** The message a reader can act on: the original rejection rather than any
 *  wrapper's own text. */
export function failureMessage(error: unknown): string {
  // SAFETY: reading an optional property off an unknown value is a presence check, not a claim.
  const cause: unknown = (error as { cause?: unknown } | null)?.cause;
  if (cause instanceof Error) return cause.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * The one live handle an adapter's Commands act on. Foldkit can release a
 * previous Mount scope after the next one has acquired, so a release clears the
 * slot only while its own handle is still the current one.
 */
export function makeLiveSlot<A>() {
  let current: A | null = null;
  return {
    get: (): A | null => current,
    acquire: <E, R>(acquire: Effect.Effect<A, E, R>, release: (handle: A) => void) =>
      Effect.acquireRelease(
        Effect.tap(acquire, (handle) =>
          Effect.sync(() => {
            current = handle;
          }),
        ),
        (handle) =>
          Effect.sync(() => {
            if (current === handle) current = null;
            release(handle);
          }),
      ),
  };
}
