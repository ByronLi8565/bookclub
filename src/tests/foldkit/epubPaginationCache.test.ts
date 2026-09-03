// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  getCachedEpubPagination,
  putCachedEpubPagination,
} from "../../client/logic/reader/epubPaginationCache.ts";

describe("EPUB pagination cache", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips page offsets without losing their numeric keys", () => {
    const key = `source:${crypto.randomUUID()}:1280x900:16:auto`;
    putCachedEpubPagination(key, {
      total: 42,
      divisor: 2,
      offsetByIndex: new Map([
        [0, 0],
        [3, 12],
      ]),
    });

    expect(getCachedEpubPagination(key)).toEqual({
      total: 42,
      divisor: 2,
      offsetByIndex: new Map([
        [0, 0],
        [3, 12],
      ]),
    });
    expect(localStorage.getItem("bookclub.epubPagination:v1")).toContain(key);
  });
});
