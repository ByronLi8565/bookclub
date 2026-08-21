// @vitest-environment jsdom

import { Effect, Option } from "effect";
import { Story, Url } from "foldkit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupSummary } from "../../shared/types/groups.ts";
import {
  ChangedOnline,
  Club,
  FailedGroups,
  Home,
  LoadGroup,
  LoadGroups,
  LoadSession,
  LoadedGroup,
  LoadedGroups,
  LoadedSession,
  DismissToastLater,
  DismissedToast,
  MissingGroup,
  Navigated,
  NoSession,
  UnreachableGroup,
  init,
  initFromUrl,
  update,
} from "../../client/foldkit/application.ts";

/**
 * The offline-first behaviour React had and the Foldkit client lost: a reader
 * who reloads stays signed in, a reader with no connection still sees their
 * clubs and can open one they have read, and a club that cannot be opened says
 * why instead of spinning.
 *
 * These are deliberately about where the Model's data comes from and what
 * happens when a fetch fails, which is exactly what the parity suite cannot
 * see — it compares markup for a Model that is handed to it.
 */

const user = { id: "reader-1", email: "reader@example.com", name: "Reader" };

const group: GroupSummary = {
  groupId: "group-1",
  slug: "club-alpha",
  publicId: "public-1",
  displayName: "Club Alpha",
  ownerId: user.id,
  sources: [],
  bookTitles: {},
  sourceMeta: {},
  memberCount: 1,
};

const membership = { isMember: true, role: "owner" } as const;

const at = (href: string): Url.Url => {
  const url = Url.fromString(`http://localhost${href}`);
  if (Option.isNone(url)) throw new Error(`unparseable: ${href}`);
  return url.value;
};

/**
 * The HTTP client resolves `fetch` once and holds it, so a per-test stub would
 * only ever install the first one. A single stub that delegates to a swappable
 * handler is what lets each test choose the answer.
 */
let respond: () => Promise<Response> = () => Promise.reject(new TypeError("no handler"));
vi.stubGlobal("fetch", () => respond());

/** The server never answers: no response is produced at all, so nothing about
 *  it can be believed and the cache is all there is. */
const unreachable = (): void => {
  respond = () => Promise.reject(new TypeError("Failed to fetch"));
};

const answers = (status: number, body: unknown): void => {
  respond = () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
};

beforeEach(() => {
  localStorage.clear();
  unreachable();
});

describe("asking who is signed in", () => {
  it("asks on the first paint of any URL", () => {
    // The regression this guards: nothing called `/auth/me`, so a reader with a
    // perfectly good cookie was shown the signed-out page and the app made no
    // request at all.
    const [, commands] = initFromUrl(at("/"));
    expect(commands.map((command) => command.name)).toContain("LoadSession");

    const [, onAClub] = initFromUrl(at("/clubs/club-alpha-public-1"));
    expect(onAClub.map((command) => command.name)).toEqual(["LoadSession", "LoadGroup"]);
  });

  it("believes a server that names the reader, and writes it down", async () => {
    answers(200, { user });
    expect(await Effect.runPromise(LoadSession().effect)).toEqual(LoadedSession({ user }));
    expect(JSON.parse(localStorage.getItem("bookclub.session.user") ?? "null")).toEqual(user);
  });

  it("believes a server that says nobody, and forgets what it knew", async () => {
    localStorage.setItem("bookclub.session.user", JSON.stringify(user));
    answers(401, { error: "unauthenticated" });
    expect(await Effect.runPromise(LoadSession().effect)).toEqual(NoSession());
    // A server that answered is authoritative; keeping the cached reader here
    // would show a signed-in app to someone whose session has expired.
    expect(localStorage.getItem("bookclub.session.user")).toBeNull();
  });

  it("keeps the reader signed in when the server never answers", async () => {
    localStorage.setItem("bookclub.session.user", JSON.stringify(user));
    unreachable();
    expect(await Effect.runPromise(LoadSession().effect)).toEqual(LoadedSession({ user }));
    expect(localStorage.getItem("bookclub.session.user")).not.toBeNull();
  });

  it("is anonymous when the server never answers and nothing was cached", async () => {
    unreachable();
    expect(await Effect.runPromise(LoadSession().effect)).toEqual(NoSession());
  });

  it("says nothing when nobody is signed in", () => {
    const [initial] = init();
    Story.story(
      update,
      Story.given(initial),
      Story.message(NoSession()),
      Story.model((model) => {
        expect(model.session._tag).toBe("AnonymousSession");
        // An anonymous visitor is an ordinary state. React raised no toast for
        // it and neither does this.
        expect(model.toasts).toEqual([]);
      }),
    );
  });

  it("takes the last reader's clubs off screen when their session has expired", () => {
    const [initial] = init();
    Story.story(
      update,
      Story.given({ ...initial, groups: [group] }),
      Story.message(NoSession()),
      Story.model((model) => expect(model.groups).toEqual([])),
    );
  });
});

describe("the club list without a connection", () => {
  it("writes the list down when the server answers", async () => {
    localStorage.setItem("bookclub.session.user", JSON.stringify(user));
    answers(200, { groups: [group] });
    expect(await Effect.runPromise(LoadGroups().effect)).toEqual(LoadedGroups({ groups: [group] }));
    expect(JSON.parse(localStorage.getItem(`bookclub.groups.${user.id}`) ?? "null")).toEqual([
      group,
    ]);
  });

  it("paints the clubs this device already knows the moment the reader is known", () => {
    localStorage.setItem(`bookclub.groups.${user.id}`, JSON.stringify([group]));
    const [initial] = init();
    Story.story(
      update,
      Story.given(initial),
      Story.message(LoadedSession({ user })),
      // No network answer has arrived yet, and the list is already there.
      Story.model((model) => expect(model.groups).toEqual([group])),
      Story.Command.resolve(LoadGroups, FailedGroups()),
      Story.model((model) => expect(model.groups).toEqual([group])),
    );
  });

  it("keeps the cached list on screen when the refresh fails", () => {
    const [initial] = init();
    Story.story(
      update,
      Story.given({ ...initial, groups: [group] }),
      Story.message(FailedGroups()),
      Story.model((model) => {
        expect(model.groups).toEqual([group]);
        expect(model.toasts).toEqual([]);
      }),
    );
  });

  it("says so only when there is nothing behind the failure", () => {
    const [initial] = init();
    Story.story(
      update,
      Story.given(initial),
      Story.message(FailedGroups()),
      Story.Command.resolve(DismissToastLater, DismissedToast({ id: "not-this-one" })),
      Story.model((model) => {
        expect(model.toasts[0]?.title).toBe("Couldn't load your clubs");
      }),
    );
  });
});

describe("opening a club without a connection", () => {
  const view = { group, membership, members: [] };

  it("writes the club down when the server answers", async () => {
    localStorage.setItem("bookclub.session.user", JSON.stringify(user));
    answers(200, view);
    expect(await Effect.runPromise(LoadGroup({ groupRef: "club-alpha-public-1" }).effect)).toEqual(
      LoadedGroup(view),
    );
    expect(
      JSON.parse(
        localStorage.getItem(`bookclub.groupview.${user.id}.club-alpha-public-1`) ?? "null",
      ).group.displayName,
    ).toBe("Club Alpha");
  });

  it("opens a club it has read before when the server never answers", async () => {
    localStorage.setItem("bookclub.session.user", JSON.stringify(user));
    localStorage.setItem(`bookclub.groupview.${user.id}.club-alpha-public-1`, JSON.stringify(view));
    unreachable();
    expect(await Effect.runPromise(LoadGroup({ groupRef: "club-alpha-public-1" }).effect)).toEqual(
      LoadedGroup(view),
    );
  });

  it("admits it is offline for a club it has never read", async () => {
    unreachable();
    expect(await Effect.runPromise(LoadGroup({ groupRef: "club-alpha-public-1" }).effect)).toEqual(
      UnreachableGroup({ groupRef: "club-alpha-public-1" }),
    );
  });

  it("reports a club the server says is not there, even with a cache to fall back on", async () => {
    localStorage.setItem("bookclub.session.user", JSON.stringify(user));
    localStorage.setItem(`bookclub.groupview.${user.id}.club-alpha-public-1`, JSON.stringify(view));
    // A deleted club must not keep opening from a stale copy for ever.
    answers(404, { error: "not_found" });
    expect(await Effect.runPromise(LoadGroup({ groupRef: "club-alpha-public-1" }).effect)).toEqual(
      MissingGroup(),
    );
  });

  it("turns each answer into a page rather than a spinner behind a toast", () => {
    const [initial] = init();
    const onAClub = { ...initial, route: Club({ groupRef: "club-alpha-public-1" }) };

    Story.story(
      update,
      Story.given(onAClub),
      Story.message(MissingGroup()),
      Story.model((model) => expect(model.clubError).toBe("notfound")),
      // Leaving the club clears the answer, so the next one does not open under
      // the last one's error.
      Story.message(Navigated({ route: Home() })),
      Story.model((model) => expect(model.clubError).toBeNull()),
    );

    Story.story(
      update,
      Story.given(onAClub),
      Story.message(UnreachableGroup({ groupRef: "club-alpha-public-1" })),
      Story.model((model) => expect(model.clubError).toBe("offline")),
    );
  });
});

describe("coming back online", () => {
  it("asks again rather than staying in whatever failed", () => {
    const [initial] = init();

    Story.story(
      update,
      Story.given({ ...initial, online: false }),
      Story.message(ChangedOnline({ online: true })),
      Story.Command.expectExact(LoadSession()),
      Story.Command.resolve(LoadSession, NoSession()),
      Story.model((model) => expect(model.online).toBe(true)),
    );
  });

  it("reloads the club the reader is standing in", () => {
    const [initial] = init();

    Story.story(
      update,
      Story.given({
        ...initial,
        online: false,
        route: Club({ groupRef: "club-alpha-public-1" }),
        clubError: "offline",
      }),
      Story.message(ChangedOnline({ online: true })),
      Story.Command.expectExact(LoadSession(), LoadGroup({ groupRef: "club-alpha-public-1" })),
      Story.Command.resolve(LoadSession, NoSession()),
      Story.Command.resolve(LoadGroup, UnreachableGroup({ groupRef: "club-alpha-public-1" })),
    );
  });

  it("asks nothing on the way out", () => {
    const [initial] = init();

    Story.story(
      update,
      Story.given(initial),
      Story.message(ChangedOnline({ online: false })),
      Story.model((model) => expect(model.online).toBe(false)),
    );
  });
});
