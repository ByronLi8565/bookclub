// @vitest-environment jsdom
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getReadingPosition,
  setLocalReadingPosition,
  syncReadingPosition,
} from "../client/logic/settings/readingPositions.ts";

const USER_ID = "user-1";
const GROUP_ID = "group-1";
const SOURCE_ID = "source-1";

describe("reading-position sync", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not overwrite navigation that happens while a sync request is in flight", async () => {
    const first = setLocalReadingPosition(USER_ID, GROUP_ID, SOURCE_ID, {
      kind: "pdf",
      page: 2,
      scrollRatio: 0,
      zoom: 100,
      percentage: 0.2,
    });
    let resolveResponse!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = vi.fn(() => response);
    vi.stubGlobal("fetch", fetchMock);

    const syncing = Effect.runPromise(syncReadingPosition(USER_ID, GROUP_ID, SOURCE_ID));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
    const latest = setLocalReadingPosition(USER_ID, GROUP_ID, SOURCE_ID, {
      kind: "pdf",
      page: 3,
      scrollRatio: 0,
      zoom: 100,
      percentage: 0.3,
    });
    resolveResponse(Response.json({ position: first.position }));
    await syncing;

    const settled = getReadingPosition(USER_ID, GROUP_ID, SOURCE_ID, "pdf");
    expect(settled?.position).toEqual(latest.position);
    expect(settled?.lastSyncedPosition).toEqual(first.position);
    expect(settled?.sync.status).toBe("dirty");
  });

  it("retries a persisted syncing record after a previous runtime stopped", async () => {
    const record = setLocalReadingPosition(USER_ID, GROUP_ID, SOURCE_ID, {
      kind: "epub",
      cfi: "epubcfi(/6/2)",
      percentage: 0.1,
    });
    localStorage.setItem(
      "bookclub.readingPositions:v1",
      JSON.stringify({
        [`${USER_ID}:${GROUP_ID}:${SOURCE_ID}`]: {
          ...record,
          sync: { ...record.sync, status: "syncing" },
        },
      }),
    );
    const fetchMock = vi.fn(() => Promise.resolve(Response.json({ position: record.position })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      Effect.runPromise(syncReadingPosition(USER_ID, GROUP_ID, SOURCE_ID)),
    ).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
