// @vitest-environment jsdom

import { Schema } from "effect";
import { Story } from "foldkit";
import { describe, expect, it } from "vitest";
import {
  DismissedToast,
  DismissToastLater,
  errorToast,
  FailedGroups,
  FOLDKIT_RUNTIME_ID,
  ChangedLoginEmail,
  LeftTheApp,
  LoadGroup,
  MissingGroup,
  PushUrl,
  ChangedNewGroupName,
  CreateGroup,
  CreatedGroup,
  FailedCreateGroup,
  StartedCreatingClub,
  SubmittedNewGroup,
  ChangedLoginPassword,
  DeleteGroup,
  DeletedGroup,
  Club,
  Home,
  LoadGroups,
  LoadInvite,
  LoadedSession,
  LoadedGroups,
  LoadedInvite,
  Model,
  Navigated,
  PasswordLogin,
  RequestedDeleteGroup,
  RequestedInvite,
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
  LoginOverlay,
  LoadAccountSecurity,
  OpenedOverlay,
  SettingsOverlay,
  init,
  makeBookclubApplication,
  update,
} from "../../client/foldkit/application.ts";
import { CompletedSettingsAction, LoadUserPrefs } from "../../client/foldkit/settings.ts";

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

  it("keeps serializable session, account, and error-toast transitions", () => {
    const [initial] = init();
    const user = { id: "user-1", email: "reader@example.com", name: "Reader" };

    Story.story(
      update,
      Story.given(initial),
      Story.message(LoadedSession({ user })),
      Story.Command.resolve(LoadGroups, LoadedGroups({ groups: [] })),
      Story.Command.resolve(LoadUserPrefs, CompletedSettingsAction()),
      Story.model((model) => {
        expect(model.session._tag).toBe("AuthenticatedSession");
        expect(model.account._tag).toBe("ReadyAccount");
        expect(Schema.decodeUnknownSync(Model)(JSON.parse(JSON.stringify(model)))).toEqual(model);
      }),
      // A club list that cannot be refreshed with nothing behind it is the one
      // load failure worth a sentence; the rest are ordinary states.
      Story.message(FailedGroups()),
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

  it("drives invite, deletion, and signout as explicit control-plane Commands", () => {
    const [initial] = init();

    const groupId = "group-1";
    Story.story(
      update,
      Story.given({ ...initial, route: Club({ groupRef: "club-ref" }) }),
      Story.message(RequestedInvite({ groupRef: "club-ref" })),
      Story.Command.resolve(LoadInvite, LoadedInvite({ token: "invite-token" })),
      Story.model((model) => expect(model.inviteToken).toBe("invite-token")),
      Story.message(RequestedDeleteGroup({ groupRef: "club-ref", groupId })),
      Story.Command.resolve(DeleteGroup, DeletedGroup({ groupId })),
      // Deleting a club navigates by URL rather than by assignment, so the
      // address bar can never disagree with the Model about where the reader is.
      Story.Command.expectExact(PushUrl({ href: "/" })),
      Story.Command.resolve(PushUrl, LeftTheApp()),
      // The runtime turns that push back into a route change.
      Story.message(Navigated({ route: Home() })),
      Story.model((model) => expect(model.route._tag).toBe("Home")),
      Story.message(RequestedSignOut()),
      Story.Command.resolve(SignOut, SignedOut()),
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
      Story.Command.resolve(LoadGroups, LoadedGroups({ groups: [] })),
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
      Story.Command.resolve(LoadGroups, LoadedGroups({ groups: [] })),
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
      Story.Command.resolve(LoadGroup, MissingGroup()),
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
