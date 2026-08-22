// @vitest-environment jsdom

import { Runtime } from "foldkit";
import { describe, expect, it } from "vitest";
import {
  AnonymousSession,
  AuthenticatedSession,
  Club,
  Home,
  InfoOverlay,
  LoginOverlay,
  Model,
  ReadyAccount,
  SettingsOverlay,
  UploadOverlay,
  errorToast,
  init,
  shellView,
  type Message,
  type Route,
} from "../../client/foldkit/application.ts";
import type { GroupSummary } from "../../shared/types/groups.ts";

// React's stylesheets apply through class names and nothing else, so a view that
// renders the right elements with the wrong classes is unstyled markup. These
// assert the structure `home.css` and `shared.css` are written against.
const user = { id: "reader-1", email: "reader@bookclub.test", name: "Reader" };

const group: GroupSummary = {
  groupId: "group-1",
  slug: "parity-club",
  publicId: "abc123",
  displayName: "Parity Club",
  ownerId: user.id,
  sources: ["source-1"],
  bookTitles: { "source-1": "The Picture of Dorian Gray" },
  sourceMeta: {
    "source-1": { kind: "epub", contentType: "application/epub+zip", size: 1024, addedBy: user.id },
  },
  memberCount: 1,
};

const signedIn = (route: Route): Model => ({
  ...init()[0],
  route,
  session: AuthenticatedSession({ user }),
  account: ReadyAccount({ user }),
  groups: [group],
});

/** `Runtime.embed` replaces the container rather than filling it, so the tree is
 *  captured from `document.body` before `dispose` tears it back down. */
const render = async (model: Model): Promise<HTMLElement> => {
  const container = document.createElement("div");
  container.id = "shell-view-test";
  document.body.appendChild(container);
  const handle = Runtime.embed(
    Runtime.makeElement<Model, Message>({
      Model,
      container,
      init: () => [model, []],
      update: (current) => [current, []],
      view: (current, h) => shellView(current, h),
      devTools: false,
      slow: false,
    }),
  );
  await new Promise((resolve) => {
    setTimeout(resolve, 200);
  });
  const html = document.body.innerHTML;
  handle.dispose();
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return holder;
};

describe("the Foldkit shell", () => {
  it("draws the home page on the card the stylesheet expects", async () => {
    const tree = await render(signedIn(Home()));

    expect(tree.querySelector(".home > .home-card")).not.toBeNull();
    expect(tree.querySelector(".home-main > .home-title")?.textContent).toBe("Bookclub");
    expect(tree.querySelector(".home-corner--login .login-email")?.textContent).toBe(user.email);
    expect(tree.querySelector(".home-corner--credit")).not.toBeNull();
    // React offers the button first and the name field only once it is pressed.
    expect(tree.querySelector("button.home-action")?.textContent).toBe("create a new bookclub");
    expect(tree.querySelector(".home-create")).toBeNull();
    const creating = await render({ ...signedIn(Home()), creatingClub: true });
    expect(creating.querySelector(".home-create .home-create-confirm")).not.toBeNull();
    // React's card carries settings and info in its top-left corner.
    expect(tree.querySelector(".home-top-buttons .home-settings-button")).not.toBeNull();
    expect(tree.querySelector(".home-top-buttons .home-info-button")?.textContent).toBe("i");
  });

  it("lists clubs as the card's club list", async () => {
    const tree = await render(signedIn(Home()));

    const entries = tree.querySelectorAll(".home-clubs .home-club-list li");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.textContent).toContain(group.displayName);
    expect(entries[0]?.textContent).toContain("invite");
  });

  it("tells a signed-out reader where to start", async () => {
    const tree = await render({ ...init()[0], route: Home() });

    expect(tree.querySelector(".login-signin")).not.toBeNull();
    expect(tree.querySelector(".home-existing-label")?.textContent).toContain("sign in");
    // Nothing to create, and no settings, until there is a session.
    expect(tree.querySelector(".home-create")).toBeNull();
    expect(tree.querySelector(".home-settings-button")).toBeNull();
  });

  it("presents signing in as a modal over the card", async () => {
    const tree = await render({ ...init()[0], route: Home(), overlay: LoginOverlay() });

    // The backdrop is a sibling of the card, not a wrapper around it: `.home`
    // only fills the viewport as a direct child of the full-height root, so an
    // extra element in between collapses the card to its contents and the page
    // jumps.
    expect(tree.querySelector(".foldkit-root > .home > .home-card")).not.toBeNull();
    expect(tree.querySelector(".home > .modal-backdrop")).not.toBeNull();
    // A `<dialog>` without `open` is hidden by the UA stylesheet, so the route
    // renders and shows nothing. `querySelector` finds it either way.
    expect(tree.querySelector(".modal-backdrop dialog.modal[open]")).not.toBeNull();
    expect(tree.querySelector(".modal-backdrop .modal .modal-head")).not.toBeNull();
    expect(tree.querySelector(".modal-body form")).not.toBeNull();
    expect(tree.querySelector("#login-email")).not.toBeNull();
    expect(tree.querySelector("#login-password")).not.toBeNull();
  });

  it("offers every way in that the React modal does", async () => {
    const tree = await render({
      ...init()[0],
      route: Home(),
      overlay: LoginOverlay(),
      passkeysAvailable: true,
      loginEmail: "reader@bookclub.test",
    });

    // Without a password the primary action mails a code rather than signing in.
    expect(tree.querySelector(".modal-body .primary")?.textContent).toBe("send code");
    expect(tree.querySelector(".modal-body .login-passkey")).not.toBeNull();
    expect(tree.querySelector("#login-password")?.getAttribute("placeholder")).toBe(
      "password (optional)",
    );
  });

  it("asks for the mailed code once one has been sent", async () => {
    const tree = await render({
      ...init()[0],
      route: Home(),
      overlay: LoginOverlay(),
      loginStep: "code",
      loginEmail: "reader@bookclub.test",
      loginError: "Wrong code. Try again.",
    });

    expect(tree.querySelector("#login-code")).not.toBeNull();
    expect(tree.querySelector(".modal-note")?.textContent).toContain("reader@bookclub.test");
    expect(tree.querySelector(".modal-body .primary")?.textContent).toBe("verify");
    expect(tree.querySelector(".login-error")?.textContent).toBe("Wrong code. Try again.");
  });

  it("says the sign-in worked before the modal goes away", async () => {
    const tree = await render({
      ...init()[0],
      route: Home(),
      overlay: LoginOverlay(),
      loginStep: "done",
    });

    expect(tree.querySelector(".modal-success")).not.toBeNull();
    expect(tree.querySelector("#login-email")).toBeNull();
  });

  it("opens the info screen over the card", async () => {
    const tree = await render({ ...signedIn(Home()), overlay: InfoOverlay() });

    expect(tree.querySelector("dialog.modal.home-info-panel[open]")).not.toBeNull();
    expect(tree.querySelector(".home-info-cards")).not.toBeNull();
  });

  it("opens settings over the card, with the account page inside it", async () => {
    const tree = await render({
      ...signedIn(Home()),
      overlay: SettingsOverlay(),
      passkeysAvailable: true,
    });

    expect(tree.querySelector("dialog.modal[open]")).not.toBeNull();
    // React reaches its account settings through this modal and nowhere else.
    expect(tree.querySelector(".account-passkey-add .settings-action")).not.toBeNull();
    expect(tree.querySelector(".account-password-form")).not.toBeNull();
  });

  it("shows a club that is still resolving as the workspace shell", async () => {
    const tree = await render(signedIn(Club({ groupRef: "parity-club-abc123" })));

    // Not the home card: the page must not jump when the book arrives.
    expect(tree.querySelector(".app > .topbar .topbar-home")).not.toBeNull();
    expect(tree.querySelector(".workspace-layout.split .workspace-layout-track")).not.toBeNull();
    expect(
      tree.querySelector<HTMLElement>(".workspace-layout-track > .split-pane")?.style.width,
    ).toBe("62%");
    expect(tree.querySelector(".workspace-layout-track > .split-divider")).not.toBeNull();
    expect(tree.querySelector(".reader-surface .loading--reader")).not.toBeNull();
    expect(tree.querySelector(".note-panel .loading--note-panel")).not.toBeNull();
  });

  it("sends a signed-out reader to the sign-in modal on a club page", async () => {
    const tree = await render({
      ...init()[0],
      route: Club({ groupRef: "parity-club-abc123" }),
      session: AnonymousSession(),
    });

    expect(tree.querySelector(".home-main")?.textContent).toContain("Sign in to open this club");
    expect(tree.querySelector("dialog.modal[open]")).not.toBeNull();
  });

  it("offers the upload flow when a club has no book", async () => {
    const empty = { ...group, sources: [], bookTitles: {}, sourceMeta: {} };
    const tree = await render({
      ...signedIn(Club({ groupRef: "parity-club-abc123" })),
      currentGroup: empty,
      groups: [empty],
    });

    expect(tree.querySelector(".home-title")?.textContent).toBe(group.displayName);
    expect(tree.querySelector(".home-upload-link")?.textContent).toContain("upload the club's");
  });

  it("opens the upload modal from the empty club", async () => {
    const empty = { ...group, sources: [], bookTitles: {}, sourceMeta: {} };
    const tree = await render({
      ...signedIn(Club({ groupRef: "parity-club-abc123" })),
      currentGroup: empty,
      groups: [empty],
      overlay: UploadOverlay(),
    });

    expect(tree.querySelector(".home > .modal-backdrop dialog.modal[open]")).not.toBeNull();
  });

  it("raises toasts the way React's viewport does", async () => {
    const tree = await render({
      ...signedIn(Home()),
      toasts: [errorToast("Rename failed", "Couldn't rename the club.")],
    });

    expect(tree.querySelector(".toast-viewport .toast.toast--error")).not.toBeNull();
    expect(tree.querySelector(".toast-head strong")?.textContent).toBe("Rename failed");
    expect(tree.querySelector(".toast-body p")?.textContent).toBe("Couldn't rename the club.");
  });

  it("says so when the browser goes offline", async () => {
    const tree = await render({ ...signedIn(Home()), online: false });

    expect(tree.querySelector(".foldkit-root > .offline-banner")).not.toBeNull();
  });
});
