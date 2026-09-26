// @vitest-environment jsdom

import { Effect, Schema } from "effect";
import { Story } from "foldkit";
import { describe, expect, it, vi } from "vitest";
import {
  DismissedToast,
  DismissToastLater,
  errorToast,
  FailedClientCommand,
  FailedGroup,
  FailedGroups,
  FOLDKIT_RUNTIME_ID,
  ChangedLoginEmail,
  LeftTheApp,
  LoadGroup,
  LoadedGroup,
  PasskeyLogin,
  PushUrl,
  RenameGroup,
  RenamedGroup,
  ReplaceUrl,
  SelectedBook,
  ChangedNewGroupName,
  CreateGroup,
  CreatedGroup,
  FailedCreateGroup,
  StartedCreatingClub,
  SubmittedNewGroup,
  ChangedLoginPassword,
  ChangedRenameDraft,
  CommittedRename,
  LoadGroups,
  LoadedSession,
  LoadedGroups,
  Model,
  Navigated,
  PasswordLogin,
  RequestedSignOut,
  SignOut,
  SignedOut,
  SubmittedLogin,
  SubmittedLoginCode,
  SentLoginCode,
  StartLogin,
  VerifyLoginCode,
  FailedLogin,
  DismissedLogin,
  CloseLoginAfterSuccess,
  ChangedLoginCode,
  CompletedAccountAction,
  FailedAccountSecurity,
  LoginOverlay,
  LoadAccountSecurity,
  LoadedAccountSecurity,
  OpenedOverlay,
  RequestedSetPassword,
  SetAccountPassword,
  SettingsOverlay,
  StartedRename,
  init,
  makeBookclubApplication,
  update,
  type Model as AppModel,
} from "../../client/foldkit/application.ts";
import { Club, Home } from "../../client/foldkit/routes.ts";
import { ToggledReaderLayout } from "../../client/foldkit/reader.ts";
import {
  CompletedSettingsAction,
  LoadUserPrefs,
  SaveClubProfile,
  SavedClubProfile,
  SubmittedDisplayName,
  UploadedAvatar,
} from "../../client/foldkit/settings.ts";
import type { GroupSummary } from "../../shared/types/groups.ts";

/** The generated client resolves `fetch` once and holds it, so one stub that
 *  delegates to a swappable answer is what lets each test choose one. */
let respond: () => Promise<Response> = () => Promise.reject(new TypeError("Failed to fetch"));
vi.stubGlobal("fetch", () => respond());

const reader = { id: "reader-1", email: "reader@example.com", name: "Reader" };

const club: GroupSummary = {
  groupId: "group-1",
  slug: "club",
  publicId: "alpha",
  displayName: "Club",
  ownerId: reader.id,
  sources: ["source-1", "source-2"],
  bookTitles: {},
  sourceMeta: {
    "source-1": { kind: "pdf", contentType: "application/pdf", size: 1, addedBy: reader.id },
    "source-2": { kind: "pdf", contentType: "application/pdf", size: 1, addedBy: reader.id },
  },
  memberCount: 1,
};

/** A signed-in member standing in a loaded club with no book open yet. */
const inClub = (): AppModel => {
  const [initial] = init();
  const [signedIn] = update(initial, LoadedSession({ user: reader }));
  const [routed] = update(signedIn, Navigated({ route: Club({ groupRef: "club-alpha" }) }));
  return update(
    routed,
    LoadedGroup({
      groupRef: "club-alpha",
      group: club,
      membership: { isMember: true, role: "owner" },
      members: [{ id: reader.id, name: "Reader", email: reader.email, role: "owner" }],
    }),
  )[0];
};

describe("Foldkit Bookclub boundary", () => {
  it("opens public settings without requesting private account security", () => {
    const [initial] = init();
    const [anonymous, anonymousCommands] = update(
      initial,
      OpenedOverlay({ overlay: SettingsOverlay() }),
    );
    expect(anonymous.overlay).toEqual(SettingsOverlay());
    expect(anonymousCommands.map((command) => command.name)).not.toContain(
      LoadAccountSecurity.name,
    );

    const [signedIn, sessionCommands] = update(
      initial,
      LoadedSession({ user: { id: "reader-1", email: "reader@example.com", name: "Reader" } }),
    );
    expect(sessionCommands.map((command) => command.name)).toContain(LoadUserPrefs.name);
    const [, signedInCommands] = update(signedIn, OpenedOverlay({ overlay: SettingsOverlay() }));
    expect(signedInCommands.map((command) => command.name)).toContain(LoadAccountSecurity.name);
  });

  it("does not expose empty account security state while its request is pending", () => {
    const [initial] = init();
    const user = { id: "reader-1", email: "reader@example.com", name: "Reader" };
    const [signedIn] = update(initial, LoadedSession({ user }));
    const [opened, commands] = update(signedIn, OpenedOverlay({ overlay: SettingsOverlay() }));

    expect(opened.accountSecurityStatus).toBe("loading");
    expect(commands.map(({ name, args }) => ({ name, args }))).toContainEqual({
      name: LoadAccountSecurity.name,
      args: { userId: user.id },
    });

    const [ignored, ignoredCommands] = update(
      opened,
      RequestedSetPassword({ password: "long-enough" }),
    );
    expect(ignored.accountBusy).toBe(false);
    expect(ignoredCommands).toEqual([]);

    const [ready] = update(
      opened,
      LoadedAccountSecurity({ userId: user.id, passkeys: [], hasPassword: false }),
    );
    const [saving, saveCommands] = update(ready, RequestedSetPassword({ password: "long-enough" }));
    expect(saving.accountBusy).toBe(true);
    expect(saveCommands.map((command) => command.name)).toEqual([SetAccountPassword.name]);

    const [refreshing, refreshCommands] = update(
      saving,
      CompletedAccountAction({ title: "Password saved", message: "Saved." }),
    );
    expect(refreshing.accountSecurityStatus).toBe("loading");
    expect(refreshCommands.map((command) => command.name)).toContain(LoadAccountSecurity.name);
  });

  it("ignores account security answers for an earlier reader", () => {
    const [initial] = init();
    const user = { id: "reader-1", email: "reader@example.com", name: "Reader" };
    const [signedIn] = update(initial, LoadedSession({ user }));

    const [lateSuccess] = update(
      signedIn,
      LoadedAccountSecurity({ userId: "reader-2", passkeys: [], hasPassword: true }),
    );
    expect(lateSuccess.hasPassword).toBe(false);

    const [lateFailure] = update(signedIn, FailedAccountSecurity({ userId: "reader-2" }));
    expect(lateFailure.toasts).toEqual([]);
  });

  it("keeps serializable session, account, and error-toast transitions", () => {
    const [initial] = init();
    const user = { id: "user-1", email: "reader@example.com", name: "Reader" };

    Story.story(
      update,
      Story.given(initial),
      Story.message(LoadedSession({ user })),
      Story.Command.resolve(LoadGroups, LoadedGroups({ userId: user.id, groups: [] })),
      Story.Command.resolve(LoadUserPrefs, CompletedSettingsAction()),
      Story.model((model) => {
        expect(model.session._tag).toBe("AuthenticatedSession");
        expect(Schema.decodeUnknownSync(Model)(JSON.parse(JSON.stringify(model)))).toEqual(model);
      }),
      // A club list that cannot be refreshed with nothing behind it is the one
      // load failure worth a sentence; the rest are ordinary states.
      Story.message(FailedGroups({ userId: user.id })),
      Story.model((model) => {
        expect(model.toasts).toHaveLength(1);
        expect(model.toasts[0]?.message).toBe("You appear to be offline. Try again later.");
        expect(model.toasts[0]?.type).toBe("error");
      }),
      // Raising a toast schedules its own removal, the way React's store times
      // one out; a toast with no timer would sit on screen forever.
      Story.Command.resolve(DismissToastLater, DismissedToast({ id: "already-gone" })),
      Story.model((model) => expect(model.toasts).toHaveLength(1)),
    );

    const container = document.createElement("div");
    expect(makeBookclubApplication(container).runtimeId).toBe(FOLDKIT_RUNTIME_ID);
  });

  it("signs out through a Command and lands on the clubs card by URL", () => {
    const [initial] = init();

    Story.story(
      update,
      Story.given({ ...initial, route: Club({ groupRef: "club-ref" }) }),
      Story.message(RequestedSignOut()),
      Story.Command.resolve(SignOut, SignedOut()),
      // Signing out navigates by URL rather than by assignment, so the address
      // bar can never disagree with the Model about where the reader is.
      Story.Command.expectExact(PushUrl({ href: "/" })),
      Story.Command.resolve(PushUrl, LeftTheApp()),
      Story.model((model) => expect(model.session._tag).toBe("AnonymousSession")),
    );
  });

  it("routes and submits the serializable password form through a generated-client Command", () => {
    const [initial] = init();

    Story.story(
      update,
      Story.given(initial),
      Story.message(ChangedLoginEmail({ email: "reader@example.com" })),
      Story.message(ChangedLoginPassword({ password: "secret-password" })),
      Story.message(SubmittedLogin()),
      Story.Command.expectExact(
        PasswordLogin({ email: "reader@example.com", password: "secret-password" }),
      ),
      Story.Command.resolve(
        PasswordLogin,
        LoadedSession({ user: { id: "reader-1", email: "reader@example.com", name: "Reader" } }),
      ),
      Story.Command.resolve(LoadGroups, LoadedGroups({ userId: "reader-1", groups: [] })),
      Story.Command.resolve(LoadUserPrefs, CompletedSettingsAction()),
      Story.message(Navigated({ route: Home() })),
      Story.model((model) => expect(model.route).toEqual(Home())),
    );
  });
  it("falls back to a mailed code when no password was typed", () => {
    const [initial] = init();

    Story.story(
      update,
      Story.given(initial),
      Story.message(OpenedOverlay({ overlay: LoginOverlay() })),
      Story.message(ChangedLoginEmail({ email: "reader@example.com" })),
      Story.message(SubmittedLogin()),
      Story.Command.expectExact(StartLogin({ email: "reader@example.com" })),
      Story.Command.resolve(StartLogin, SentLoginCode()),
      Story.model((model) => {
        expect(model.loginStep).toBe("code");
        expect(model.loginBusy).toBe(false);
      }),
      Story.message(ChangedLoginCode({ code: "123456" })),
      Story.message(SubmittedLoginCode()),
      Story.Command.expectExact(VerifyLoginCode({ email: "reader@example.com", code: "123456" })),
      Story.Command.resolve(
        VerifyLoginCode,
        LoadedSession({ user: { id: "reader-1", email: "reader@example.com", name: "Reader" } }),
      ),
      Story.Command.resolve(LoadGroups, LoadedGroups({ userId: "reader-1", groups: [] })),
      Story.Command.resolve(LoadUserPrefs, CompletedSettingsAction()),
      // The modal says it worked before it goes away, so it is still up.
      Story.model((model) => {
        expect(model.loginStep).toBe("done");
        expect(model.overlay._tag).toBe("LoginOverlay");
      }),
      Story.Command.resolve(CloseLoginAfterSuccess, DismissedLogin()),
      Story.model((model) => {
        expect(model.overlay._tag).toBe("NoOverlay");
        expect(model.loginStep).toBe("email");
        expect(model.loginEmail).toBe("");
      }),
    );
  });

  it("turns an API error code into the sentence the reader sees", () => {
    const [initial] = init();

    Story.story(
      update,
      Story.given(initial),
      Story.message(OpenedOverlay({ overlay: LoginOverlay() })),
      Story.message(ChangedLoginEmail({ email: "reader@example.com" })),
      Story.message(ChangedLoginPassword({ password: "wrong" })),
      Story.message(SubmittedLogin()),
      Story.model((model) => expect(model.loginBusy).toBe(true)),
      Story.Command.resolve(PasswordLogin, FailedLogin({ error: "bad_password" })),
      Story.model((model) => {
        expect(model.loginBusy).toBe(false);
        expect(model.loginError).toBe("Wrong password. Try again, or sign in with a code.");
        // A wrong password leaves the form where it was so a code can be asked for.
        expect(model.loginStep).toBe("email");
      }),
    );
  });
  it("asks for a club name only once the reader asks to create one", () => {
    const [initial] = init();
    const group = {
      groupId: "group-1",
      slug: "new-club",
      publicId: "public-1",
      displayName: "New Club",
      ownerId: "reader-1",
      sources: [],
      bookTitles: {},
      sourceMeta: {},
      memberCount: 1,
    };

    Story.story(
      update,
      Story.given(initial),
      Story.model((model) => expect(model.creatingClub).toBe(false)),
      Story.message(StartedCreatingClub()),
      Story.message(ChangedNewGroupName({ name: "New Club" })),
      Story.message(SubmittedNewGroup()),
      Story.Command.expectExact(CreateGroup({ displayName: "New Club" })),
      // A second submit while the first is still in flight would create two
      // clubs, so the pending flag is what closes the form to it.
      Story.model((model) => expect(model.newGroupPending).toBe(true)),
      Story.Command.resolve(CreateGroup, CreatedGroup({ group })),
      Story.Command.expectExact(PushUrl({ href: "/clubs/new-club-public-1" })),
      Story.Command.resolve(PushUrl, LeftTheApp()),
      Story.message(Navigated({ route: Club({ groupRef: "new-club-public-1" }) })),
      // Loading the club itself is another story's subject; this one ends at
      // the route the push produced.
      Story.Command.resolve(
        LoadGroup,
        FailedGroup({ groupRef: "new-club-public-1", reason: "notfound" }),
      ),
      Story.model((model) => {
        expect(model.creatingClub).toBe(false);
        expect(model.newGroupName).toBe("");
        expect(model.route).toEqual(Club({ groupRef: "new-club-public-1" }));
      }),
    );
  });

  it("says why a club name was refused, in the field and in a toast", () => {
    const [initial] = init();

    Story.story(
      update,
      Story.given({ ...initial, creatingClub: true, newGroupName: "x".repeat(200) }),
      Story.message(SubmittedNewGroup()),
      Story.Command.resolve(CreateGroup, FailedCreateGroup({ error: "too_long" })),
      Story.Command.resolve(DismissToastLater, DismissedToast({ id: "not-this-one" })),
      Story.model((model) => {
        expect(model.newGroupError).toBe("That name is too long! 100 characters max.");
        expect(model.newGroupPending).toBe(false);
        expect(model.toasts[0]?.message).toBe("That name is too long! 100 characters max.");
        // The field stays up so the name can be shortened rather than retyped.
        expect(model.creatingClub).toBe(true);
      }),
    );
  });

  it("takes a toast off screen when its own timer comes back", () => {
    const [initial] = init();
    const toast = errorToast("Rename failed", "Couldn't rename the club.");

    Story.story(
      update,
      Story.given({ ...initial, toasts: [toast] }),
      Story.message(DismissedToast({ id: toast.id })),
      Story.model((model) => expect(model.toasts).toEqual([])),
    );
  });
});

describe("the reader follows the reader's preferences", () => {
  it("opens a book in the page layout and arrow keys that were chosen", () => {
    const model = inClub();
    const [opened] = update(
      {
        ...model,
        settings: {
          ...model.settings,
          prefs: {
            ...model.settings.prefs,
            reader: { ...model.settings.prefs.reader, pdfPageLayout: "auto", smartArrows: "off" },
          },
        },
      },
      SelectedBook({ sourceId: "source-1" }),
    );

    expect(opened.reader?.layout).toBe("auto");
    expect(opened.reader?.smartArrows).toBe("off");
  });

  it("flips the layout that is showing, and the stored preference with it", () => {
    const [opened] = update(inClub(), SelectedBook({ sourceId: "source-1" }));
    const shown = opened.reader?.layout;
    const [toggled] = update(opened, ToggledReaderLayout());

    expect(toggled.reader?.layout).not.toBe(shown);
    expect(toggled.settings.prefs.reader.pdfPageLayout).toBe(toggled.reader?.layout);
    const [back] = update(toggled, ToggledReaderLayout());
    expect(back.reader?.layout).toBe(shown);
  });
});

describe("the viewer's own club profile", () => {
  it("keeps a saved nickname and photo on the viewer's roster entry", () => {
    Story.story(
      update,
      Story.given(inClub()),
      Story.message(SubmittedDisplayName({ groupId: club.groupId, displayName: "Ishmael" })),
      Story.Command.resolve(
        SaveClubProfile,
        SavedClubProfile({ profile: { id: reader.id, displayName: "Ishmael" } }),
      ),
      Story.Command.resolve(DismissToastLater, DismissedToast({ id: "not-this-one" })),
      Story.message(UploadedAvatar({ imageId: "image-1" })),
      Story.Command.resolve(DismissToastLater, DismissedToast({ id: "not-this-one" })),
      Story.model((model) => {
        // The settings page reads the viewer's name back from the roster; a
        // roster left alone snaps the field back to the old name.
        expect(model.members.find((member) => member.id === reader.id)).toMatchObject({
          name: "Ishmael",
          avatarImageId: "image-1",
        });
      }),
    );
  });
});

describe("a jump held for a book", () => {
  const anchor = { kind: "pdf-text" as const, page: 3, rects: [] };

  it("is dropped when the reader opens a different book instead", () => {
    const model = { ...inClub(), pendingJump: { sourceId: "source-2", anchor } };
    const [opened] = update(model, SelectedBook({ sourceId: "source-1" }));

    expect(opened.pendingJump).toBeNull();
  });

  it("is dropped when the reader leaves the club", () => {
    const model = { ...inClub(), pendingJump: { sourceId: "source-2", anchor } };
    const [left] = update(model, Navigated({ route: Home() }));

    expect(left.pendingJump).toBeNull();
  });
});

describe("renaming a club", () => {
  it("keeps the club where it was in the list and replaces the URL", () => {
    const other = { ...club, groupId: "group-2", slug: "other", publicId: "beta" };
    const renamed = { ...club, slug: "the-whale", displayName: "The Whale" };

    Story.story(
      update,
      Story.given({ ...inClub(), groups: [club, other] }),
      Story.message(StartedRename({ value: club.displayName })),
      Story.message(ChangedRenameDraft({ value: "The Whale" })),
      Story.message(CommittedRename()),
      Story.Command.expectExact(RenameGroup({ groupRef: "club-alpha", title: "The Whale" })),
      Story.Command.resolve(RenameGroup, RenamedGroup({ group: renamed })),
      // A rename is not somewhere new to go back from.
      Story.Command.expectExact(ReplaceUrl({ href: "/clubs/the-whale-alpha" })),
      Story.Command.resolve(ReplaceUrl, LeftTheApp()),
      Story.model((model) => {
        expect(model.groups.map((group) => group.displayName)).toEqual(["The Whale", "Club"]);
        expect(model.currentGroup?.displayName).toBe("The Whale");
        expect(model.renamingClub).toBe(false);
      }),
    );
  });
});

describe("requests that never reach the server", () => {
  it("turns a passkey sign-in with no connection into a sign-in error", async () => {
    respond = () => Promise.reject(new TypeError("Failed to fetch"));
    const failed = await Effect.runPromise(PasskeyLogin({ email: reader.email }).effect);

    expect(failed._tag).toBe("FailedLogin");
  });

  it("names a refused passkey sign-in by the server's code", async () => {
    respond = () =>
      Promise.resolve(
        new Response(JSON.stringify({ _tag: "NotFound", error: "no_passkeys" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      );
    expect(await Effect.runPromise(PasskeyLogin({ email: reader.email }).effect)).toEqual(
      FailedLogin({ error: "no_passkeys" }),
    );
  });

  it("says in words that a sign-out did not go through", async () => {
    respond = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(await Effect.runPromise(SignOut().effect)).toEqual(
      FailedClientCommand({ message: "Couldn't sign out. Try again." }),
    );
  });
});
