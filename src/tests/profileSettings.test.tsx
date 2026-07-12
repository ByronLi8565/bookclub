// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupRole } from "../shared/types/groups.ts";
import { PresenceModal } from "../client/ui/group/PresenceModal.tsx";
import { SettingsModal } from "../client/ui/workspace/SettingsModal.tsx";

describe("club user settings", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = window.document.createElement("div");
    window.document.documentElement.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({ token: "invite-token", link: "https://example.com/invite" }),
        ),
      ),
    );
  });

  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("opens club settings on the USER page with the current profile", async () => {
    await act(() =>
      root.render(
        <SettingsModal
          book={{
            groupId: "club-id",
            profile: { id: "user-id", displayName: "Club Name", avatarImageId: "avatar-id" },
            onProfileChange: vi.fn(),
          }}
          onClose={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector<HTMLInputElement>("[aria-label='Display name']")?.value).toBe(
      "Club Name",
    );
    expect(container.querySelector(".settings-user-avatar img")?.getAttribute("src")).toBe(
      "/users/user-id/avatar/avatar-id",
    );
    expect(
      container.querySelector<HTMLButtonElement>("button[aria-pressed='true']")?.textContent,
    ).toBe("User");
    const submit = container.querySelector<HTMLButtonElement>("[aria-label='Save display name']");
    expect(submit?.classList.contains("settings-text-submit-button")).toBe(true);
    expect(submit?.textContent).toBe("↵");
  });

  it("uses live profile names and avatars in the people list", async () => {
    await act(() =>
      root.render(
        <PresenceModal
          groupRef="club-ref"
          group={{
            groupId: "club-id",
            slug: "club",
            publicId: "public-id",
            displayName: "Club",
            ownerId: "owner-id",
            sources: [],
            bookTitles: {},
            sourceMeta: {},
            memberCount: 1,
          }}
          members={[
            {
              id: "user-id",
              name: "Old Name",
              email: "reader@example.com",
              role: GroupRole.Member,
            },
          ]}
          online={[
            {
              id: "user-id",
              name: "Club Name",
              role: GroupRole.Member,
              avatarImageId: "avatar-id",
            },
          ]}
          viewerId="user-id"
          viewerRole={GroupRole.Member}
          onChangeMemberRole={vi.fn(() => Promise.resolve(true))}
          onDeleteBook={vi.fn(() => Promise.resolve(true))}
          onUpdateBookMetadata={vi.fn(() => Promise.resolve(true))}
          onClose={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector(".invite-person-name")?.textContent).toBe("Club Name");
    expect(container.querySelector(".invite-avatar img")?.getAttribute("src")).toBe(
      "/users/user-id/avatar/avatar-id",
    );
  });

  it("confirms role changes offered to admins", async () => {
    const onChangeMemberRole = vi.fn(() => Promise.resolve(true));
    await act(() =>
      root.render(
        <PresenceModal
          groupRef="club-ref"
          group={{
            groupId: "club-id",
            slug: "club",
            publicId: "public-id",
            displayName: "Club",
            ownerId: "owner-id",
            sources: [],
            bookTitles: {},
            sourceMeta: {},
            memberCount: 1,
          }}
          members={[
            {
              id: "member-id",
              name: "Reader",
              email: "reader@example.com",
              role: GroupRole.Member,
            },
          ]}
          online={[]}
          viewerId="admin-id"
          viewerRole={GroupRole.Admin}
          onChangeMemberRole={onChangeMemberRole}
          onDeleteBook={vi.fn(() => Promise.resolve(true))}
          onUpdateBookMetadata={vi.fn(() => Promise.resolve(true))}
          onClose={vi.fn()}
        />,
      ),
    );

    const role = container.querySelector<HTMLButtonElement>(
      "[aria-label='Change role for Reader']",
    );
    await act(() => role?.click());
    const options = [...container.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']")];
    expect(options.map((option) => option.textContent)).toEqual(["visitor", "member"]);
    await act(() => options[0]?.click());
    expect(container.querySelector("[aria-label='Confirm role change']")?.textContent).toContain(
      "Really change this user to VISITOR?",
    );
    const confirm = container.querySelector<HTMLButtonElement>(
      "button[aria-label='confirm role change']",
    );
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
    });
    expect(onChangeMemberRole).toHaveBeenCalledWith("member-id", GroupRole.Visitor);
  });

  it("shows owner-scoped book tools without an unknown word-count label", async () => {
    const onDeleteBook = vi.fn(() => Promise.resolve(true));
    await act(() =>
      root.render(
        <PresenceModal
          groupRef="club-ref"
          group={{
            groupId: "club-id",
            slug: "club",
            publicId: "public-id",
            displayName: "Club",
            ownerId: "owner-id",
            sources: ["book-id"],
            bookTitles: { "book-id": "Book" },
            sourceMeta: {
              "book-id": {
                kind: "epub",
                contentType: "application/epub+zip",
                size: 1024,
                addedBy: "user-id",
              },
            },
            memberCount: 1,
          }}
          members={[]}
          online={[]}
          viewerId="user-id"
          viewerRole={GroupRole.Owner}
          onChangeMemberRole={vi.fn(() => Promise.resolve(true))}
          onDeleteBook={onDeleteBook}
          onUpdateBookMetadata={vi.fn(() => Promise.resolve(true))}
          onClose={vi.fn()}
        />,
      ),
    );
    const booksTab = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Books",
    );
    await act(() => booksTab?.click());

    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "Backup notes",
      ),
    ).toBe(true);
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "Restore notes",
      ),
    ).toBe(true);
    expect(container.querySelector(".group-book-stats")?.textContent).toBe("1.0 KB");
    const metadataButton = container.querySelector<HTMLButtonElement>(
      "[aria-label='Edit book metadata']",
    );
    expect(metadataButton).not.toBeNull();
    await act(() => metadataButton?.click());
    const authorInput = container.querySelector<HTMLInputElement>("[placeholder='Author name']");
    expect(authorInput?.closest(".group-book-metadata")).not.toBeNull();
    expect(authorInput?.closest("form")?.classList.contains("settings-text-submit-form")).toBe(
      true,
    );
    expect(container.querySelector("[aria-label='Save author']")?.classList).toContain(
      "settings-text-submit-button",
    );
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "Download local copy",
      ),
    ).toBe(true);
    const deleteButton = container.querySelector<HTMLButtonElement>("[aria-label='Delete Book']");
    expect(deleteButton).not.toBeNull();

    await act(() => deleteButton?.click());
    const confirm = container.querySelector<HTMLButtonElement>(
      "button[aria-label='confirm delete']",
    );
    expect(confirm).not.toBeNull();
    expect(confirm?.disabled).toBe(false);
    await act(() => confirm?.click());

    expect(container.querySelector(".book-delete-backup-warning")?.textContent).toContain(
      "strongly recommend backing up your notes",
    );
    const titleInput = container.querySelector<HTMLInputElement>("#book-delete-title");
    const finalDelete = container.querySelector<HTMLButtonElement>(
      ".book-delete-final-actions button[type='submit']",
    );
    expect(finalDelete?.disabled).toBe(true);
    await act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(titleInput, "Book");
      titleInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(finalDelete?.disabled).toBe(false);
    await act(async () => {
      finalDelete?.click();
      await Promise.resolve();
    });
    expect(onDeleteBook).toHaveBeenCalledWith("book-id");
  });

  it("lists hidden image previews and lets admins delete them", async () => {
    const imageId = "01JH0000000000000000000000";
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/groups/club-ref/images" && init?.method !== "DELETE") {
        return Promise.resolve(
          Response.json({
            images: [
              {
                id: imageId,
                size: 1536,
                contentType: "image/webp",
                uploadedAt: "2026-01-01T00:00:00.000Z",
                uploadedBy: "member-id",
                uploaderName: "Reader",
              },
            ],
            totalSize: 1536,
          }),
        );
      }
      if (url === `/groups/club-ref/images/${imageId}` && init?.method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(
        Response.json({ token: "invite-token", link: "https://example.com/invite" }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );

    await act(() =>
      root.render(
        <PresenceModal
          groupRef="club-ref"
          group={{
            groupId: "club-id",
            slug: "club",
            publicId: "public-id",
            displayName: "Club",
            ownerId: "owner-id",
            sources: [],
            bookTitles: {},
            sourceMeta: {},
            memberCount: 1,
          }}
          members={[]}
          online={[]}
          viewerId="admin-id"
          viewerRole={GroupRole.Admin}
          onChangeMemberRole={vi.fn(() => Promise.resolve(true))}
          onDeleteBook={vi.fn(() => Promise.resolve(true))}
          onUpdateBookMetadata={vi.fn(() => Promise.resolve(true))}
          onClose={vi.fn()}
        />,
      ),
    );
    const imagesTab = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Images",
    );
    await act(async () => {
      imagesTab?.click();
      await Promise.resolve();
    });

    expect(container.querySelector(".group-books-summary")?.textContent).toContain("1.5 KB total");
    expect(container.querySelector(".group-image-info")?.textContent).toContain(
      "image 1uploaded by Reader · size 1.5 KB",
    );
    expect(container.querySelector(".group-image-preview")).toBeNull();

    const view = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "[view]",
    );
    await act(() => view?.click());
    expect(container.querySelector(".group-image-preview")?.getAttribute("src")).toBe(
      `/groups/club-ref/images/${imageId}`,
    );

    const remove = container.querySelector<HTMLButtonElement>("[aria-label='Delete image 1']");
    await act(async () => {
      remove?.click();
      await Promise.resolve();
    });
    expect(container.querySelector(".group-image-info")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(`/groups/club-ref/images/${imageId}`, {
      method: "DELETE",
    });
  });
});
