/**
 * Runs layout work one pass at a time. A request made while a pass is waiting
 * to start joins that pass instead of queueing another: the pass reads the
 * latest wanted layout when it begins, so a burst of changes (a pane animating
 * its width, a held zoom key) costs one relayout. A request made while a pass
 * is running queues exactly one more, which sees whatever changed meanwhile.
 * A failed pass rejects only its own callers; the next request runs normally.
 */
export function makeLayoutQueue(pass: () => Promise<void>): () => Promise<void> {
  let settled: Promise<unknown> = Promise.resolve();
  let waiting: Promise<void> | null = null;
  return () => {
    if (waiting) return waiting;
    const next = settled.then(() => {
      waiting = null;
      return pass();
    });
    waiting = next;
    settled = next.catch(() => {});
    return next;
  };
}
