// @vitest-environment jsdom

import { Runtime } from "foldkit";
import { Story } from "foldkit/test";
import { afterEach, describe, expect, it } from "vitest";
import {
  ChangedInviteEmail,
  ClearedInviteLinkCopied,
  CopiedInviteLink,
  CopyInviteLink,
  FailedInvite,
  FailedInviteLinkRotation,
  ForgetInviteLinkCopied,
  InviteModel,
  LoadInviteLink,
  LoadedInviteLink,
  MarkedInviteLinkCopied,
  OpenedInvite,
  RotatedInviteLink,
  SendInvite,
  SentInvite,
  SubmittedInvite,
  initialInviteModel,
  inviteView,
  isInviteMessage,
  updateInvite,
  type InviteMessage,
} from "../../client/foldkit/invite.ts";

const group = { slug: "parity-club", publicId: "abc123", displayName: "Parity Club" };
const groupRef = "parity-club-abc123";
const link = "https://bookclub.test/join/token-1";

const loaded = (): InviteModel => ({ ...initialInviteModel(), link, linkLoading: false });

/** `Runtime.embed` replaces the container rather than filling it, so the tree
 *  lands in `document.body`. Assertions run against the live tree: `value` and
 *  `disabled` are DOM properties, and serialising the HTML would drop them. */
let disposeRendered: (() => void) | null = null;

afterEach(() => {
  disposeRendered?.();
  disposeRendered = null;
  document.body.innerHTML = "";
});

const render = async (model: InviteModel): Promise<HTMLElement> => {
  disposeRendered?.();
  document.body.innerHTML = "";
  const container = document.createElement("div");
  // The runtime mounts by container id; an id-less container is never replaced.
  container.id = "invite-view-test";
  document.body.appendChild(container);
  const handle = Runtime.embed(
    Runtime.makeElement<InviteModel, InviteMessage>({
      Model: InviteModel,
      container,
      init: () => [model, []],
      update: (current) => [current, []],
      // Closing is the host's message; the test only needs one that type-checks.
      view: (current, h) => inviteView(current, { group, onClose: FailedInvite() }, h),
      devTools: false,
      slow: false,
    }),
  );
  disposeRendered = () => handle.dispose();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 200);
  });
  return document.body;
};

describe("Foldkit invite stories", () => {
  it("recognises only its own messages", () => {
    expect(isInviteMessage(FailedInvite())).toBe(true);
    expect(isInviteMessage({ _tag: "ChangedNoteComposer" })).toBe(false);
  });

  it("asks for the club's link when the modal opens", () => {
    Story.story(
      updateInvite,
      Story.given({ ...loaded(), email: "left@over.test" }),
      Story.message(OpenedInvite({ groupRef })),
      Story.model((model) => {
        expect(model).toEqual({ ...initialInviteModel(), linkLoading: true });
        expect(JSON.parse(JSON.stringify(model))).toEqual(model);
      }),
      Story.Command.expectExact(LoadInviteLink({ groupRef, rotate: false })),
      Story.Command.resolve(LoadInviteLink, LoadedInviteLink({ link })),
      Story.model((model) => {
        expect(model.link).toBe(link);
        expect(model.linkLoading).toBe(false);
      }),
    );
  });

  it("sends an invite and empties the field the sender typed into", () => {
    Story.story(
      updateInvite,
      Story.given(loaded()),
      Story.message(ChangedInviteEmail({ email: "reader@bookclub.test" })),
      Story.message(SubmittedInvite({ groupRef })),
      Story.model((model) => expect(model.busy).toBe(true)),
      Story.Command.expectExact(SendInvite({ groupRef, email: "reader@bookclub.test" })),
      Story.Command.resolve(SendInvite, SentInvite({ email: "reader@bookclub.test" })),
      Story.model((model) => {
        expect(model.email).toBe("");
        expect(model.busy).toBe(false);
      }),
    );
  });

  it("keeps the typed address when the invite fails", () => {
    Story.story(
      updateInvite,
      Story.given(loaded()),
      Story.message(ChangedInviteEmail({ email: "reader@bookclub.test" })),
      Story.message(SubmittedInvite({ groupRef })),
      Story.Command.resolve(SendInvite, FailedInvite()),
      Story.model((model) => {
        expect(model.email).toBe("reader@bookclub.test");
        expect(model.busy).toBe(false);
      }),
    );
  });

  it("says Copied for a beat and then stops saying it", () => {
    Story.story(
      updateInvite,
      Story.given(loaded()),
      Story.message(CopiedInviteLink()),
      Story.Command.expectExact(CopyInviteLink({ link })),
      Story.Command.resolve(CopyInviteLink, MarkedInviteLinkCopied()),
      Story.model((model) => expect(model.copied).toBe(true)),
      Story.Command.resolve(ForgetInviteLinkCopied, ClearedInviteLinkCopied()),
      Story.model((model) => expect(model.copied).toBe(false)),
    );
  });

  it("rotates the link, and leaves the shown one alone when rotation fails", () => {
    Story.story(
      updateInvite,
      Story.given(loaded()),
      Story.message(RotatedInviteLink({ groupRef })),
      Story.model((model) => expect(model.busy).toBe(true)),
      Story.Command.expectExact(LoadInviteLink({ groupRef, rotate: true })),
      Story.Command.resolve(LoadInviteLink, FailedInviteLinkRotation()),
      Story.model((model) => {
        expect(model.busy).toBe(false);
        expect(model.link).toBe(link);
      }),
      Story.message(RotatedInviteLink({ groupRef })),
      Story.Command.resolve(LoadInviteLink, LoadedInviteLink({ link: "https://bookclub.test/b" })),
      Story.model((model) => {
        expect(model.link).toBe("https://bookclub.test/b");
        expect(model.busy).toBe(false);
      }),
    );
  });
});

describe("the Foldkit invite modal", () => {
  it("draws the modal chrome the stylesheet expects", async () => {
    const tree = await render(loaded());

    expect(tree.querySelector(".modal-backdrop > dialog.modal.modal--invite[open]")).not.toBeNull();
    expect(tree.querySelector(".modal-inner > .modal-head strong")?.textContent).toBe(
      "invite to Parity Club",
    );
    expect(tree.querySelector(".modal-inner > .modal-body > form")).not.toBeNull();
  });

  it("offers the email form with its send button disabled until something is typed", async () => {
    const empty = await render(loaded());
    const emailInput = empty.querySelector<HTMLInputElement>("form input[type=email]");
    expect(emailInput?.getAttribute("aria-label")).toBe("Invitee email");
    expect(emailInput?.getAttribute("placeholder")).toBe("invite by email");
    const send = empty.querySelector<HTMLButtonElement>("form button.primary");
    expect(send?.textContent).toBe("send invite");
    expect(send?.getAttribute("title")).toBe("Send invite");
    expect(send?.disabled).toBe(true);

    const typed = await render({ ...loaded(), email: "reader@bookclub.test" });
    expect(typed.querySelector<HTMLButtonElement>("form button.primary")?.disabled).toBe(false);
  });

  it("shows the link without its scheme, beside the copy and rotate buttons", async () => {
    const tree = await render(loaded());

    expect(tree.querySelector(".invite-share > .modal-note")?.textContent).toBe(
      "Invite with link:",
    );
    const shown = tree.querySelector<HTMLInputElement>(".invite-share .invite-link input");
    expect(shown?.value).toBe("bookclub.test/join/token-1");
    expect(shown?.hasAttribute("readonly")).toBe(true);
    const buttons = tree.querySelectorAll<HTMLButtonElement>(
      ".invite-link button.invite-icon.icon-button",
    );
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.getAttribute("aria-label")).toBe("copy link");
    expect(buttons[0]?.getAttribute("title")).toBe("Copy link");
    expect(buttons[1]?.getAttribute("aria-label")).toBe("regenerate link");
    expect(buttons[1]?.getAttribute("title")).toBe("Regenerate link");
  });

  it("swaps the copy icon's title once the link is on the clipboard", async () => {
    const tree = await render({ ...loaded(), copied: true });

    expect(tree.querySelector(".invite-link button.invite-icon")?.getAttribute("title")).toBe(
      "Copied",
    );
  });

  it("waits on the link with the loading element the stylesheet names", async () => {
    const tree = await render(initialInviteModel());

    expect(tree.querySelector(".invite-share .loading.loading--invite-link")).not.toBeNull();
    expect(tree.querySelector(".invite-link")).toBeNull();
  });
});
