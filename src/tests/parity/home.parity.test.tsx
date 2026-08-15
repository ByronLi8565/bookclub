// @vitest-environment jsdom

import { beforeEach, describe, it, vi } from "vitest";
import type { GroupSummary } from "../../shared/types/groups.ts";
import { Home as ReactHome } from "../../client/ui/home/Home.tsx";
import { Model, Home, init, shellView, type Message } from "../../client/foldkit/application.ts";
import {
  enableReactActEnvironment,
  expectParity,
  renderFoldkit,
  renderReact,
  stubAnimationFrame,
} from "./parity.ts";
import { testSession } from "./session.ts";

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

const session = testSession({ status: "authed", user });
const anonymous = testSession();

/**
 * The one deviation on this page: React's club links are anchors because they
 * navigate by URL, and Foldkit's are buttons because its route still lives in
 * the Model. Both carry the club's name and sit in the same list item.
 */
const CLUB_BUTTON = "button.login-link.plain-button[type=button]";
const routingDeviation = (line: string): string =>
  /\ba\[href=\/clubs\//u.test(line) || line.endsWith(CLUB_BUTTON)
    ? line.replace(/(\s*).*/u, "$1clubLink")
    : line;

/** The shell wraps the page in a root of its own, which React has no
 *  counterpart for because its entry renders straight into `#root`. */
const page = (root: HTMLElement): Element => {
  const inner = root.querySelector(".foldkit-root");
  if (inner === null) throw new Error("no shell root");
  return inner;
};

const foldkitHome = (overrides: Partial<Model>) => {
  const [initial] = init();
  return renderFoldkit<Model, Message>({
    Model,
    model: { ...initial, route: Home(), ...overrides },
    view: shellView,
  });
};

const signedIn = { _tag: "AuthenticatedSession", user } as const;

describe("home parity", () => {
  beforeEach(() => {
    enableReactActEnvironment();
    stubAnimationFrame();
    // React's home page loads the club list itself; both renderers are given
    // the same clubs, one over the wire and one in the Model.
    vi.stubGlobal("fetch", (input: string) =>
      Promise.resolve(
        String(input).endsWith("/groups")
          ? new Response(JSON.stringify({ groups }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          : new Response("{}", { status: 200 }),
      ),
    );
  });

  it("renders the signed-out card the way React does", async () => {
    const react = await renderReact(<ReactHome session={anonymous} />);
    expectParity(react, page(await foldkitHome({})), { rewrite: routingDeviation });
  });

  it("renders the club list the way React does", async () => {
    const react = await renderReact(<ReactHome session={session} />);
    expectParity(react, page(await foldkitHome({ groups, session: signedIn })), {
      rewrite: routingDeviation,
    });
  });

  it("renders the club-name field the way React does", async () => {
    const react = await renderReact(<ReactHome session={session} />, (container) => {
      const create = container.querySelector("button.home-action");
      if (!(create instanceof HTMLButtonElement)) throw new Error("no create button");
      create.click();
    });
    const foldkit = await foldkitHome({ groups, session: signedIn, creatingClub: true });
    expectParity(react, page(foldkit), { rewrite: routingDeviation });
  });
});
