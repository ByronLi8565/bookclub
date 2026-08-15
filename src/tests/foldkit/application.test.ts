// @vitest-environment jsdom

import { Schema } from "effect";
import { Story } from "foldkit";
import { describe, expect, it } from "vitest";
import {
  DismissedErrorToast,
  FailedSession,
  FOLDKIT_RUNTIME_ID,
  ChangedLogin,
  DeleteGroup,
  DeletedGroup,
  Group,
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
  SubmittedPasswordLogin,
  init,
  makeBookclubApplication,
  update,
} from "../../client/foldkit/application.ts";

describe("Foldkit Bookclub boundary", () => {
  it("keeps serializable session, account, and error-toast transitions", () => {
    const [initial] = init();
    const user = { id: "user-1", email: "reader@example.com", name: "Reader" };

    Story.story(
      update,
      Story.given(initial),
      Story.message(LoadedSession({ user })),
      Story.Command.resolve(LoadGroups, LoadedGroups({ groups: [] })),
      Story.model((model) => {
        expect(model.session._tag).toBe("AuthenticatedSession");
        expect(model.account._tag).toBe("ReadyAccount");
        expect(Schema.decodeUnknownSync(Model)(JSON.parse(JSON.stringify(model)))).toEqual(model);
      }),
      Story.message(FailedSession({ message: "offline" })),
      Story.model((model) => expect(model.errorToast).toEqual({ message: "offline" })),
      Story.message(DismissedErrorToast()),
      Story.model((model) => expect(model.errorToast).toBeNull()),
    );

    const container = document.createElement("div");
    expect(makeBookclubApplication(container).runtimeId).toBe(FOLDKIT_RUNTIME_ID);
  });

  it("drives invite, deletion, and signout as explicit control-plane Commands", () => {
    const [initial] = init();

    const groupId = "group-1";
    Story.story(
      update,
      Story.given({ ...initial, route: Group({ groupRef: "club-ref" }) }),
      Story.message(RequestedInvite({ groupRef: "club-ref" })),
      Story.Command.resolve(LoadInvite, LoadedInvite({ token: "invite-token" })),
      Story.model((model) => expect(model.inviteToken).toBe("invite-token")),
      Story.message(RequestedDeleteGroup({ groupRef: "club-ref", groupId })),
      Story.Command.resolve(DeleteGroup, DeletedGroup({ groupId })),
      Story.model((model) => expect(model.route._tag).toBe("Home")),
      Story.message(RequestedSignOut()),
      Story.Command.resolve(SignOut, SignedOut()),
      Story.model((model) => expect(model.session._tag).toBe("AnonymousSession")),
    );
  });

  it("routes and submits the serializable password form through a generated-client Command", () => {
    const [initial] = init();

    Story.story(
      update,
      Story.given(initial),
      Story.message(ChangedLogin({ email: "reader@example.com", password: "secret-password" })),
      Story.message(SubmittedPasswordLogin()),
      Story.Command.expectExact(
        PasswordLogin({ email: "reader@example.com", password: "secret-password" }),
      ),
      Story.Command.resolve(
        PasswordLogin,
        LoadedSession({ user: { id: "reader-1", email: "reader@example.com", name: "Reader" } }),
      ),
      Story.Command.resolve(LoadGroups, LoadedGroups({ groups: [] })),
      Story.message(Navigated({ route: Home() })),
      Story.model((model) => expect(model.route).toEqual(Home())),
    );
  });
});
