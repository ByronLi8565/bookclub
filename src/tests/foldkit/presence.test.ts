// @vitest-environment jsdom

import { Schema } from "effect";
import { Runtime } from "foldkit";
import { Story } from "foldkit/test";
import { afterEach, describe, expect, it } from "vitest";
import {
  AskToDeleteImage,
  CancelledBookDelete,
  ChangedBookDeleteTitle,
  ChangedMemberRole,
  ChangedPresencePage,
  ChoseMemberRole,
  ConfirmedBookDeleteConfirm,
  ConfirmedImageDelete,
  ConfirmedRoleChange,
  DeleteGroupBook,
  DeleteGroupImage,
  DeletedBook,
  DeletedGroupImage,
  LoadGroupImages,
  LoadedGroupImages,
  OpenedPresence,
  PresenceModel,
  RequestedImageDelete,
  SetMemberRole,
  StartedBookDeleteConfirm,
  SubmittedBookDelete,
  ToggledRoleMenu,
  initialPresenceModel,
  presenceIndicatorView,
  presencePeople,
  presencePeopleView,
  presenceView,
  updatePresence,
  type OnlinePeer,
  type PresenceMessage,
  type PresenceRosterContext,
  type PresenceViewContext,
} from "../../client/foldkit/presence.ts";
import { GroupRole, type GroupSummary, type RosterEntry } from "../../shared/types/groups.ts";

const GROUP_REF = "parity-club-abc123";

const group: GroupSummary = {
  groupId: "group-1",
  slug: "parity-club",
  publicId: "abc123",
  displayName: "Parity Club",
  ownerId: "reader-1",
  sources: ["source-1"],
  bookTitles: { "source-1": "The Picture of Dorian Gray" },
  sourceMeta: {
    "source-1": {
      kind: "epub",
      contentType: "application/epub+zip",
      size: 2048,
      author: "Oscar Wilde",
      wordCount: 78000,
      addedBy: "reader-1",
    },
  },
  memberCount: 2,
};

const members: RosterEntry[] = [
  { id: "reader-1", name: "Owner", email: "owner@bookclub.test", role: GroupRole.Owner },
  { id: "reader-2", name: "Second", email: "second@bookclub.test", role: GroupRole.Member },
];

const peers: OnlinePeer[] = [{ id: "reader-2", name: "Second", role: GroupRole.Member }];

const opened = (): PresenceModel => ({ ...initialPresenceModel(), groupRef: GROUP_REF });

const roster: PresenceRosterContext = { members, peers, viewerRole: GroupRole.Owner };

/**
 * `Runtime.embed` replaces the container element rather than filling it, so the
 * rendered tree lands in `document.body` and is captured before `dispose` tears
 * it back down.
 */
const render = async (model: PresenceModel): Promise<HTMLElement> => {
  const container = document.createElement("div");
  container.id = "presence-view-test";
  document.body.appendChild(container);
  const handle = Runtime.embed(
    Runtime.makeElement<PresenceModel, PresenceMessage>({
      Model: PresenceModel,
      container,
      init: () => [model, []],
      update: (current) => [current, []],
      view: (current, h) => {
        // `application.ts` nests the roster inside the invite slice's controls
        // and hands the settings slice's backup controls over; the stubs stand
        // in for those two arrays and carry the elements they wrap.
        const context: PresenceViewContext<PresenceMessage> = {
          group,
          ...roster,
          viewerId: "reader-1",
          onClose: CancelledBookDelete(),
          inviteControls: [
            h.form([], [h.input([h.Type("email"), h.AriaLabel("Invitee email")])]),
            presencePeopleView(current, roster, h),
            h.div([h.Class("invite-share")], []),
          ],
          backupControls: [h.div([h.Class("group-backup-controls")], [])],
        };
        return presenceView(current, context, h);
      },
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

describe("Foldkit presence stories", () => {
  it("survives a round trip through its own Schema", () => {
    const model = opened();
    expect(Schema.decodeUnknownSync(PresenceModel)(JSON.parse(JSON.stringify(model)))).toEqual(
      model,
    );
  });

  it("starts every field over when a club's modal opens", () => {
    Story.story(
      updatePresence,
      Story.given({ ...opened(), page: "images", visibleImages: ["image-1"] }),
      Story.message(OpenedPresence({ groupRef: "other-club-def456" })),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model.groupRef).toBe("other-club-def456");
        expect(model.page).toBe("people");
        expect(model.visibleImages).toEqual([]);
      }),
    );
  });

  it("loads the image page once and keeps what it found", () => {
    Story.story(
      updatePresence,
      Story.given(opened()),
      Story.message(ChangedPresencePage({ page: "images" })),
      Story.Command.expectExact(LoadGroupImages({ groupRef: GROUP_REF })),
      Story.Command.resolve(
        LoadGroupImages,
        LoadedGroupImages({
          images: [
            {
              id: "image-1",
              size: 1024,
              contentType: "image/webp",
              uploadedAt: "2026-08-15T00:00:00.000Z",
              uploadedBy: "reader-1",
              uploaderName: "Owner",
            },
          ],
          totalSize: 1024,
        }),
      ),
      Story.message(ChangedPresencePage({ page: "people" })),
      Story.message(ChangedPresencePage({ page: "images" })),
      Story.Command.expectNone(),
      Story.model((model) => expect(model.images).toHaveLength(1)),
    );
  });

  it("asks before it deletes an upload, then shrinks the tally by that upload", () => {
    Story.story(
      updatePresence,
      Story.given({
        ...opened(),
        page: "images",
        imageTotalSize: 1024,
        visibleImages: ["image-1"],
        images: [
          {
            id: "image-1",
            size: 1024,
            contentType: "image/webp",
            uploadedAt: "2026-08-15T00:00:00.000Z",
            uploadedBy: "reader-1",
            uploaderName: "Owner",
          },
        ],
      }),
      Story.message(RequestedImageDelete({ imageId: "image-1", size: 1024, index: 0 })),
      Story.Command.expectExact(AskToDeleteImage({ imageId: "image-1", size: 1024, index: 0 })),
      Story.Command.resolve(
        AskToDeleteImage,
        ConfirmedImageDelete({ imageId: "image-1", size: 1024 }),
      ),
      Story.Command.expectExact(
        DeleteGroupImage({ groupRef: GROUP_REF, imageId: "image-1", size: 1024 }),
      ),
      Story.Command.resolve(
        DeleteGroupImage,
        DeletedGroupImage({ imageId: "image-1", size: 1024 }),
      ),
      Story.model((model) => {
        expect(model.images).toEqual([]);
        expect(model.imageTotalSize).toBe(0);
        expect(model.visibleImages).toEqual([]);
      }),
    );
  });

  it("holds a book delete behind the popover, the modal, and the typed title", () => {
    Story.story(
      updatePresence,
      Story.given({ ...opened(), page: "books" }),
      Story.message(StartedBookDeleteConfirm({ sourceId: "source-1" })),
      Story.model((model) => expect(model.confirmingDeleteSourceId).toBe("source-1")),
      Story.message(
        ConfirmedBookDeleteConfirm({ sourceId: "source-1", title: "The Picture of Dorian Gray" }),
      ),
      Story.model((model) => expect(model.pendingBookDelete?.sourceId).toBe("source-1")),
      Story.message(SubmittedBookDelete()),
      Story.Command.expectNone(),
      Story.message(ChangedBookDeleteTitle({ title: "The Picture of Dorian Gray" })),
      Story.message(SubmittedBookDelete()),
      Story.Command.expectExact(DeleteGroupBook({ groupRef: GROUP_REF, sourceId: "source-1" })),
      Story.model((model) => expect(model.deletingId).toBe("source-1")),
      Story.Command.resolve(DeleteGroupBook, DeletedBook({ group })),
      Story.model((model) => expect(model.pendingBookDelete).toBeNull()),
    );
  });

  it("confirms a role change before it writes one", () => {
    Story.story(
      updatePresence,
      Story.given(opened()),
      Story.message(ToggledRoleMenu({ memberId: "reader-2" })),
      Story.model((model) => expect(model.openRoleMenuId).toBe("reader-2")),
      Story.message(ChoseMemberRole({ memberId: "reader-2", role: GroupRole.Admin })),
      Story.model((model) => {
        expect(model.openRoleMenuId).toBeNull();
        expect(model.pendingRole).toBe(GroupRole.Admin);
      }),
      Story.message(ConfirmedRoleChange()),
      Story.Command.expectExact(
        SetMemberRole({ groupRef: GROUP_REF, memberId: "reader-2", role: GroupRole.Admin }),
      ),
      Story.Command.resolve(
        SetMemberRole,
        ChangedMemberRole({ members: [members[0]!, { ...members[1]!, role: GroupRole.Admin }] }),
      ),
      Story.model((model) => {
        expect(model.savingRole).toBe(false);
        expect(model.pendingRole).toBeNull();
      }),
    );
  });

  it("merges the roster with the socket's peers and sorts the present first", () => {
    const people = presencePeople(members, peers);
    expect(people.map((person) => person.id)).toEqual(["reader-2", "reader-1"]);
    expect(people[0]?.isOnline).toBe(true);
    expect(people[0]?.email).toBe("second@bookclub.test");
    expect(people[1]?.isOnline).toBe(false);
  });
});

describe("Foldkit presence view", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("draws the modal chrome, the people page, and the pager the stylesheet expects", async () => {
    const tree = await render(opened());

    expect(tree.querySelector(".modal-backdrop > dialog.modal.modal--invite[open]")).not.toBeNull();
    expect(tree.querySelector(".modal-inner > .modal-body.group-modal-body")).not.toBeNull();
    expect(
      tree.querySelector(".group-modal-body > form input[aria-label='Invitee email']"),
    ).not.toBeNull();
    expect(tree.querySelector(".group-modal-body > .invite-share")).not.toBeNull();
    expect(tree.querySelector(".invite-people > .invite-people-head.label")?.textContent).toBe(
      "1 of 2 online",
    );

    const rows = tree.querySelectorAll(".invite-people-list > li");
    expect(rows).toHaveLength(2);
    expect(
      rows[0]?.querySelector(".invite-avatar > .presence-pip.presence-pip--on"),
    ).not.toBeNull();
    expect(rows[1]?.className).toBe("person--offline");
    expect(rows[1]?.querySelector(".presence-pip.presence-pip--off")).not.toBeNull();
    expect(
      rows[0]?.querySelector(".invite-person-text > .invite-person-name.truncate")?.textContent,
    ).toBe("Second");
    expect(rows[0]?.querySelector(".invite-person-email.truncate")).not.toBeNull();

    expect(
      tree.querySelector(".pager-tabs.settings-tabs button[aria-pressed='true']")?.textContent,
    ).toBe("People");
  });

  it("offers the role dropdown to whoever may reassign, and a bare label otherwise", async () => {
    const tree = await render({ ...opened(), openRoleMenuId: "reader-2" });
    const rows = tree.querySelectorAll(".invite-people-list > li");

    const control = rows[0]?.querySelector(".invite-person-role-control");
    expect(control).not.toBeNull();
    expect(
      control?.querySelector(".book-menu.settings-dropdown.invite-person-role-dropdown"),
    ).not.toBeNull();
    expect(
      control?.querySelector(
        "button.settings-action.settings-dropdown-trigger.invite-person-role.label",
      ),
    ).not.toBeNull();
    expect(control?.querySelectorAll("ul.book-menu-list[role='menu'] > li")).toHaveLength(3);
    expect(control?.querySelector(".book-menu-item.is-active")?.textContent).toBe("member");

    // The owner's own row can never be reassigned, so it is a plain label.
    expect(rows[1]?.querySelector(".invite-person-role-control")).toBeNull();
    expect(rows[1]?.querySelector("span.invite-person-role.label")?.textContent).toBe("owner");
  });

  it("draws the role-change confirmation as an open dialog", async () => {
    const tree = await render({
      ...opened(),
      pendingRoleMemberId: "reader-2",
      pendingRole: GroupRole.Admin,
    });

    const confirm = tree.querySelector("dialog.delete-confirm.role-change-confirm[open]");
    expect(confirm).not.toBeNull();
    expect(confirm?.textContent).toContain("Really change this user to ADMIN?");
    expect(confirm?.querySelectorAll(".delete-confirm-actions button")).toHaveLength(2);
  });

  it("draws the books page with its backup controls, summary, and tools", async () => {
    const tree = await render({ ...opened(), page: "books" });

    // The settings slice owns `BackupControls`; presence only decides that an
    // owner sees it, and where in the page it sits.
    expect(tree.querySelector(".group-books > .group-backup-controls")).not.toBeNull();
    expect(tree.querySelector(".group-books-summary.label")?.textContent).toBe(
      "1 book · 2.0 KB total",
    );

    const row = tree.querySelector(".group-books-list > li > .group-book-row");
    expect(row?.querySelector(".group-book-info > .group-book-name")?.textContent).toBe(
      "The Picture of Dorian Gray",
    );
    expect(row?.querySelector(".group-book-author")?.textContent).toBe("Oscar Wilde");
    expect(row?.querySelector(".group-book-stats")?.textContent).toBe("78,000 words · 2.0 KB");
    expect(row?.querySelectorAll(".group-book-actions .group-book-icon")).toHaveLength(2);
    expect(row?.querySelector(".group-book-delete")).not.toBeNull();
  });

  it("opens the book tools into the metadata editor", async () => {
    const tree = await render({
      ...opened(),
      page: "books",
      editingMetadataSourceId: "source-1",
      authorDraft: "Oscar Wilde",
    });

    const editor = tree.querySelector(".group-books-list > li > .group-book-metadata");
    expect(editor).not.toBeNull();
    expect(
      editor?.querySelector("form.settings-text-submit-form input#book-author-source-1"),
    ).not.toBeNull();
    expect(
      editor?.querySelector("button.settings-action.settings-text-submit-button"),
    ).not.toBeNull();
    expect(editor?.querySelector(".settings-action.group-book-download")).not.toBeNull();
  });

  it("draws the inline delete popover and the typed-title modal that follows it", async () => {
    const popover = await render({
      ...opened(),
      page: "books",
      confirmingDeleteSourceId: "source-1",
    });
    expect(
      popover.querySelector(".group-book-delete > dialog.delete-confirm[open]"),
    ).not.toBeNull();

    const modal = await render({
      ...opened(),
      pendingBookDelete: { sourceId: "source-1", title: "The Picture of Dorian Gray" },
    });
    expect(modal.querySelector("dialog.modal.book-delete-modal[open]")).not.toBeNull();
    expect(modal.querySelector("form.modal-body.book-delete-confirm-body")).not.toBeNull();
    expect(modal.querySelector(".book-delete-backup-warning")).not.toBeNull();
    expect(modal.querySelector("input#book-delete-title")).not.toBeNull();
    const actions = modal.querySelectorAll(".book-delete-final-actions button");
    expect(actions).toHaveLength(2);
    expect(actions[1]?.textContent).toBe("delete book and notes");
  });

  it("draws the images page, its loading state, and an open preview", async () => {
    const loading = await render({ ...opened(), page: "images" });
    expect(loading.querySelector(".group-images > .group-images-loading")?.textContent).toBe(
      "Loading…",
    );

    const tree = await render({
      ...opened(),
      page: "images",
      imageTotalSize: 1024,
      visibleImages: ["image-1"],
      images: [
        {
          id: "image-1",
          size: 1024,
          contentType: "image/webp",
          uploadedAt: "2026-08-15T00:00:00.000Z",
          uploadedBy: "reader-1",
          uploaderName: "Owner",
        },
      ],
    });
    expect(tree.querySelector(".group-images > .group-books-summary.label")?.textContent).toBe(
      "1 image · 1.0 KB total",
    );
    const row = tree.querySelector(".group-images-list > li > .group-image-row");
    expect(row?.querySelector(".group-image-info")?.textContent).toBe(
      "image 1uploaded by Owner · size 1.0 KB",
    );
    expect(row?.querySelector(".group-image-actions > .group-image-view")?.textContent).toBe(
      "[hide]",
    );
    expect(tree.querySelector(".group-images-list > li > img.group-image-preview")).not.toBeNull();
  });

  it("reports an image failure on the class the stylesheet colours", async () => {
    const tree = await render({
      ...opened(),
      page: "images",
      imageError: "Could not load images.",
    });
    expect(tree.querySelector(".group-images-error")?.textContent).toBe("Could not load images.");
  });
});

describe("the presence indicator", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("draws the header's count and dot", async () => {
    const container = document.createElement("div");
    container.id = "presence-indicator-test";
    document.body.appendChild(container);
    const handle = Runtime.embed(
      Runtime.makeElement<PresenceModel, PresenceMessage>({
        Model: PresenceModel,
        container,
        init: () => [opened(), []],
        update: (current) => [current, []],
        view: (_current, h) => presenceIndicatorView(3, CancelledBookDelete(), h),
        devTools: false,
        slow: false,
      }),
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    const html = document.body.innerHTML;
    handle.dispose();
    const tree = document.createElement("div");
    tree.innerHTML = html;

    const button = tree.querySelector("button.presence-indicator");
    expect(button?.getAttribute("aria-label")).toBe("3 people online — show group");
    expect(button?.getAttribute("title")).toBe("Show group");
    expect(button?.querySelector(".presence-count")?.textContent).toBe("3");
    expect(button?.querySelector(".presence-dot")).not.toBeNull();
  });
});
