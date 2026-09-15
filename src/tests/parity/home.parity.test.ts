// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import type { GroupSummary } from "../../shared/types/groups.ts";
import {
  AnonymousSession,
  Model,
  Home,
  init,
  shellView,
  type Message,
} from "../../client/foldkit/application.ts";
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
    expectRecordedParity("home-signed-out", await foldkitHome({ session: AnonymousSession() }));
  });

  it("does not present a pending session or club request as an empty state", async () => {
    const session = await foldkitHome({});
    expect(session.textContent).toContain("LOADING");
    expect(session.textContent).not.toContain("sign in to see your clubs");

    const clubs = await foldkitHome({ session: signedIn, groupsStatus: "loading" });
    expect(clubs.querySelector(".loading--home-clubs")).not.toBeNull();
    expect(clubs.textContent).not.toContain("no clubs yet");
  });

  it("marks cached clubs as refreshing until the server answers", async () => {
    const cached = await foldkitHome({ groups, session: signedIn, groupsStatus: "loading" });
    expect(cached.textContent).toContain("Club Alpha");
    expect(cached.querySelector(".home-clubs-status")?.textContent).toBe("refreshing clubs…");
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
