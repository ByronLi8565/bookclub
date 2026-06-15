import { describe, expect, it } from "vitest";
import { parseName } from "../server/util/names.ts";

describe("parseName", () => {
  it("normalizes the URL key without changing display casing or spaces", () => {
    expect(parseName("  THIS  Is A Club  ")).toEqual({
      ok: true,
      name: { key: "this-is-a-club", display: "THIS  Is A Club" },
    });
  });
});
