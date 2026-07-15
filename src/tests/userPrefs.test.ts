// @vitest-environment jsdom
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("user preference hydration", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not overwrite a local change made while hydration is in flight", async () => {
    let resolveResponse!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT") {
          return Promise.resolve(Response.json(JSON.parse(String(init.body))));
        }
        return new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        });
      }),
    );
    const { hydrateUserPrefs, setReaderPref } =
      await import("../client/logic/settings/userPrefs.ts");

    const hydration = Effect.runPromise(hydrateUserPrefs());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    setReaderPref("pdfPageLayout", "auto");
    resolveResponse(
      Response.json({
        prefs: {
          reader: {
            smartArrows: "instant",
            readingPositionOpenPolicy: "prefer-sync",
            pdfPageLayout: "single",
          },
          notes: { showAvatars: true },
        },
      }),
    );

    await expect(hydration).resolves.toMatchObject({ reader: { pdfPageLayout: "auto" } });
  });
});
