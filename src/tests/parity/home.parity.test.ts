// @vitest-environment jsdom

import { beforeEach, describe, it } from "vitest";
import type { GroupSummary } from "../../shared/types/groups.ts";
import { Model, Home, init, shellView, type Message } from "../../client/foldkit/application.ts";
import { expectRecordedParity, renderFoldkit, stubAnimationFrame } from "./parity.ts";

const user = { id: "reader-1", email: "one@example.com", name: "Reader One" };

const groups: GroupSummary[] = [
  {
    groupId: "group-1",
    slug: "club-alpha",
    publicId: "public-1",
    displayName: "Club Alpha",
    ownerId: user.id,
    sources: ["source-1"],
    bookTitles: { "source-1": "The Book" },
    sourceMeta: {},
    memberCount: 2,
  },
];

const signedIn = { _tag: "AuthenticatedSession", user } as const;

/** The shell wraps the page in a root of its own, which React had no
 *  counterpart for because its entry rendered straight into `#root`. */
const page = (root: HTMLElement): Element => {
  const inner = root.querySelector(".foldkit-root");
  if (inner === null) throw new Error("no shell root");
  return inner;
};

const foldkitHome = async (overrides: Partial<Model>) => {
  const [initial] = init();
  return page(
    await renderFoldkit<Model, Message>({
      Model,
      model: { ...initial, route: Home(), ...overrides },
      view: shellView,
    }),
  );
};

describe("home parity", () => {
  beforeEach(stubAnimationFrame);

  it("renders the signed-out card React rendered", async () => {
    expectRecordedParity("home-signed-out", await foldkitHome({}));
  });

  it("renders the club list React rendered", async () => {
    expectRecordedParity("home-club-list", await foldkitHome({ groups, session: signedIn }));
  });

  it("renders the club-name field React rendered", async () => {
    expectRecordedParity(
      "home-naming-a-club",
      await foldkitHome({ groups, session: signedIn, creatingClub: true }),
    );
  });
});
