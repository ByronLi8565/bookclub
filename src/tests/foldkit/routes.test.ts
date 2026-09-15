import { Option } from "effect";
import { Url } from "foldkit";
import { describe, expect, it } from "vitest";
import { Club, Home, hrefFor, routeOf } from "../../client/foldkit/routes.ts";

const at = (href: string) => {
  const url = Url.fromString(`http://localhost${href}`);
  if (Option.isNone(url)) throw new Error(`unparseable: ${href}`);
  return routeOf(url.value);
};

describe("the Foldkit route table", () => {
  it("serves the two URLs React serves", () => {
    expect(at("/")).toEqual(Home());
    expect(at("/clubs/club-alpha-public-1")).toEqual(Club({ groupRef: "club-alpha-public-1" }));
  });

  it("carries the invite and linked book through routing", () => {
    expect(at("/clubs/club-alpha-public-1?invite=tok-123&book=source-456")).toEqual(
      Club({ groupRef: "club-alpha-public-1", invite: "tok-123", book: "source-456" }),
    );
  });

  it("puts a URL it does not serve on the clubs card", () => {
    expect(at("/nope/nowhere")).toEqual(Home());
  });

  it("builds club hrefs without replaying an invite token", () => {
    expect(hrefFor(Home())).toBe("/");
    expect(hrefFor(Club({ groupRef: "club-alpha-public-1" }))).toBe("/clubs/club-alpha-public-1");
    // A link back to a club must never re-offer the invite it was joined with.
    expect(hrefFor(Club({ groupRef: "club-alpha-public-1", invite: "tok-123" }))).toBe(
      "/clubs/club-alpha-public-1",
    );
    expect(hrefFor(Club({ groupRef: "club-alpha-public-1", book: "source-456" }))).toBe(
      "/clubs/club-alpha-public-1?book=source-456",
    );
  });
});
