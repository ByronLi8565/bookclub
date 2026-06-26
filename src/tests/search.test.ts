import { describe, expect, it } from "vitest";
import { scanText } from "../client/logic/notes/highlights.ts";

describe("scanText", () => {
  it("returns no matches for an empty query", () => {
    expect(scanText("the quick brown fox", "")).toEqual([]);
  });

  it("returns no matches when the query is absent", () => {
    expect(scanText("the quick brown fox", "cat")).toEqual([]);
  });

  it("finds a single match with its start offset", () => {
    const [match, ...rest] = scanText("the quick brown fox", "brown");
    expect(rest).toEqual([]);
    expect(match?.start).toBe(10);
    expect(match?.excerpt).toBe("the quick brown fox");
  });

  it("matches case-insensitively while preserving original-case excerpts", () => {
    const [match] = scanText("The Quick Brown Fox", "brown");
    expect(match?.start).toBe(10);
    expect(match?.excerpt).toBe("The Quick Brown Fox");
  });

  it("finds every non-overlapping occurrence in reading order", () => {
    const matches = scanText("ababab", "ab");
    expect(matches.map((m) => m.start)).toEqual([0, 2, 4]);
  });

  it("does not report overlapping matches", () => {
    expect(scanText("aaa", "aa").map((m) => m.start)).toEqual([0]);
  });

  it("collapses whitespace and trims the excerpt to a single line", () => {
    const [match] = scanText("alpha\n\t  needle   beta", "needle");
    expect(match?.excerpt).toBe("alpha needle beta");
  });

  it("clips excerpt context to 40 chars on each side", () => {
    const left = "x".repeat(60);
    const right = "y".repeat(60);
    const [match] = scanText(`${left}NEEDLE${right}`, "needle");
    expect(match?.excerpt).toBe(`${"x".repeat(40)}NEEDLE${"y".repeat(40)}`);
  });
});
