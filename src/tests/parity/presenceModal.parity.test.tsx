// @vitest-environment jsdom

import { beforeEach, describe, it, vi } from "vitest";
import type { GroupSummary, RosterEntry } from "../../shared/types/groups.ts";
import { PresenceModal } from "../../client/ui/group/PresenceModal.tsx";
import {
  Model,
  PresenceOverlay,
  init,
  overlayView,
  type Message,
} from "../../client/foldkit/application.ts";
import {
  enableReactActEnvironment,
  expectParity,
  renderFoldkit,
  renderReact,
  stubAnimationFrame,
} from "./parity.ts";

const groupRef = "club-alpha";
const sourceId = "source-1";

const group: GroupSummary = {
  groupId: "group-1",
  slug: groupRef,
  publicId: "public-1",
  displayName: "Club Alpha",
  ownerId: "reader-1",
  sources: [sourceId],
  bookTitles: { [sourceId]: "The Book" },
  sourceMeta: {
    [sourceId]: {
      kind: "epub",
      contentType: "application/epub+zip",
      size: 1024,
      title: "The Book",
      author: "An Author",
      wordCount: 1000,
      addedBy: "reader-1",
    },
  },
  memberCount: 2,
};

const members: RosterEntry[] = [
  { id: "reader-1", name: "Reader One", email: "one@example.com", role: "owner" },
  { id: "reader-2", name: "Reader Two", email: "two@example.com", role: "member" },
];

const peers = [{ id: "reader-2", name: "Reader Two", role: "member" as const }];

const refuse = () => Promise.resolve(false);

const reactPresence = () => (
  <PresenceModal
    groupRef={groupRef}
    group={group}
    members={members}
    online={peers}
    viewerId="reader-1"
    viewerRole="owner"
    onChangeMemberRole={refuse}
    onDeleteBook={refuse}
    onUpdateBookMetadata={refuse}
    onClose={() => {}}
  />
);

/** React reaches its pages by clicking a tab, where Foldkit reaches them by
 *  Model, so the comparison drives each side the way its own renderer works. */
const clickTab = (container: HTMLElement, label: string): void => {
  const tab = [...container.querySelectorAll(".pager-tabs button")].find(
    (button) => button.textContent === label,
  );
  if (!(tab instanceof HTMLButtonElement)) throw new Error(`no ${label} tab`);
  tab.click();
};

const foldkitPresence = (overrides: Partial<Model>) => {
  const [initial] = init();
  const model: Model = {
    ...initial,
    overlay: PresenceOverlay(),
    currentGroup: group,
    members,
    membership: { isMember: true, role: "owner" },
    session: {
      _tag: "AuthenticatedSession",
      user: { id: "reader-1", email: "one@example.com", name: "Reader One" },
    },
    notes: { ...initial.notes, peers },
    // React starts with no link either; both show the row once its fetch settles.
    invite: { ...initial.invite, linkLoading: false },
    ...overrides,
  };
  return renderFoldkit<Model, Message>({
    Model,
    model,
    view: (current, h) => overlayView(current, h)[0] ?? h.div([], []),
  });
};

describe("presence modal parity", () => {
  beforeEach(() => {
    enableReactActEnvironment();
    stubAnimationFrame();
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("{}", { status: 200 })));
  });

  it("renders the people page the way React does", async () => {
    expectParity(await renderReact(reactPresence()), await foldkitPresence({}));
  });

  it("renders the books page the way React does", async () => {
    const react = await renderReact(reactPresence(), (container) => clickTab(container, "Books"));
    const [initial] = init();
    expectParity(
      react,
      await foldkitPresence({ presence: { ...initial.presence, page: "books" } }),
    );
  });
});
