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

  it("carries the invite token an invite link puts in the query", () => {
    // The link the server hands out is `/clubs/<ref>?invite=<token>`; a client
    // that drops the token cannot let an invited reader in at all.
    expect(at("/clubs/club-alpha-public-1?invite=tok-123")).toEqual(
      Club({ groupRef: "club-alpha-public-1", invite: "tok-123" }),
    );
  });

  it("puts a URL it does not serve on the clubs card", () => {
    expect(at("/nope/nowhere")).toEqual(Home());
  });

  it("builds the href a route is reached by, without the token", () => {
    expect(hrefFor(Home())).toBe("/");
    expect(hrefFor(Club({ groupRef: "club-alpha-public-1" }))).toBe("/clubs/club-alpha-public-1");
    // A link back to a club must never re-offer the invite it was joined with.
    expect(hrefFor(Club({ groupRef: "club-alpha-public-1", invite: "tok-123" }))).toBe(
      "/clubs/club-alpha-public-1",
    );
  });
});
