import { describe, expect, it } from "vitest";
import { makeLayoutQueue } from "../client/logic/reader/layoutQueue.ts";

/** A pass that stays open until the test lets it finish. */
function gatedPasses() {
  const gates: Array<() => void> = [];
  let started = 0;
  const pass = () =>
    new Promise<void>((resolve) => {
      started += 1;
      gates.push(resolve);
    });
  return {
    pass,
    started: () => started,
    finishNext: async () => {
      gates.shift()?.();
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    },
  };
}

describe("layout queue", () => {
  it("collapses a burst behind a running pass into a single follow-up pass", async () => {
    const passes = gatedPasses();
    const request = makeLayoutQueue(passes.pass);

    const first = request();
    await Promise.resolve();
    const burst = [request(), request(), request()];

    expect(new Set(burst).size, "every request in the burst joins one pass").toBe(1);
    await passes.finishNext();
    expect(passes.started(), "the follow-up starts only after the running pass").toBe(2);
    await passes.finishNext();
    await Promise.all([first, ...burst]);
    expect(passes.started(), "the burst cost one relayout").toBe(2);
  });

  it("keeps serving requests after a pass fails", async () => {
    let calls = 0;
    const request = makeLayoutQueue(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error("redisplay failed")) : Promise.resolve();
    });

    await expect(request(), "the failed pass rejects its caller").rejects.toThrow(
      "redisplay failed",
    );
    await expect(request(), "the next change is applied normally").resolves.toBeUndefined();
    expect(calls).toBe(2);
  });
});
