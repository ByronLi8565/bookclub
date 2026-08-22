// @vitest-environment jsdom
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLocalBookmarks,
  mergeBookmarks,
  setLocalBookmark,
  syncBookmarksWith,
} from "../client/logic/settings/bookmarks.ts";

const USER_ID = "reader-1";
const GROUP_ID = "group-1";
const SOURCE_ID = "source-1";
const position = { kind: "epub" as const, cfi: "epubcfi(/6/8)", percentage: 0.21 };

describe("bookmark storage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T12:00:00.000Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("keeps one latest record per color, including deletion tombstones", () => {
    setLocalBookmark({
      userId: USER_ID,
      groupId: GROUP_ID,
      sourceId: SOURCE_ID,
      color: "red",
      position,
      deleted: false,
    });
    vi.setSystemTime(new Date("2026-08-22T12:00:01.000Z"));
    const removed = setLocalBookmark({
      userId: USER_ID,
      groupId: GROUP_ID,
      sourceId: SOURCE_ID,
      color: "red",
      position,
      deleted: true,
    });

    expect(getLocalBookmarks(USER_ID, GROUP_ID, SOURCE_ID)).toEqual([removed]);
    expect(removed.deletedAt).toBe("2026-08-22T12:00:01.000Z");
  });

  it("prefers the newest color record when merging another device", () => {
    const local = setLocalBookmark({
      userId: USER_ID,
      groupId: GROUP_ID,
      sourceId: SOURCE_ID,
      color: "blue",
      position,
      deleted: false,
    });
    const remote = {
      ...local,
      position: { ...position, cfi: "epubcfi(/6/10)" },
      updatedAt: "2026-08-22T12:00:02.000Z",
    };

    expect(mergeBookmarks(USER_ID, GROUP_ID, SOURCE_ID, [remote])).toEqual([remote]);
  });

  it("pushes every local color slot on the sync beat", async () => {
    const bookmark = setLocalBookmark({
      userId: USER_ID,
      groupId: GROUP_ID,
      sourceId: SOURCE_ID,
      color: "orange",
      position,
      deleted: false,
    });
    const pushed: string[] = [];
    const transport = {
      fetch: () => Effect.succeed([]),
      push: (candidate: typeof bookmark) =>
        Effect.sync(() => {
          pushed.push(candidate.color);
          return [candidate];
        }),
    };

    await Effect.runPromise(syncBookmarksWith(transport, USER_ID, GROUP_ID, SOURCE_ID));
    expect(pushed).toEqual(["orange"]);
  });
});
