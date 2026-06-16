import { describe, expect, it } from "vitest";
import { groupUrlName, publicIdFromGroupUrl, slugForGroup } from "../shared/groupUrls.ts";

describe("group URLs", () => {
  it("keeps display names readable in URLs while suffixing the public id", () => {
    expect(slugForGroup("  THIS is a Really Long Name!  ")).toBe("this-is-a-really-long-name");
    expect(groupUrlName({ slug: "this-is-a-really-long-name", publicId: "k7p9qx" })).toBe(
      "this-is-a-really-long-name-k7p9qx",
    );
    expect(publicIdFromGroupUrl("this-is-a-really-long-name-k7p9qx")).toBe("k7p9qx");
  });

  it("falls back when the display name has no URL-safe characters", () => {
    expect(slugForGroup("!!!")).toBe("club");
  });
});
