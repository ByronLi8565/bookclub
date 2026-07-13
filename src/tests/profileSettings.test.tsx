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
    // The avatar id must be resolved into the /users/:id/avatar/:imageId URL —
    // a wrong join here silently shows the wrong (or a broken) picture.
    expect(container.querySelector(".settings-user-avatar img")?.getAttribute("src")).toBe(
      "/users/user-id/avatar/avatar-id",
    );
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

    // The bug this guards: a book with a known byte size once rendered an
    // "unknown" word-count label. The stats must show the size instead.
    expect(container.querySelector(".group-book-stats")?.textContent).toBe("1.0 KB");
    const metadataButton = container.querySelector<HTMLButtonElement>(
      "[aria-label='Edit book metadata']",
    );
    await act(() => metadataButton?.click());
    const authorInput = container.querySelector<HTMLInputElement>("[placeholder='Author name']");
    expect(
      authorInput?.closest(".group-book-metadata"),
      "editing opens the metadata form",
    ).not.toBeNull();

    const deleteButton = container.querySelector<HTMLButtonElement>("[aria-label='Delete Book']");
    await act(() => deleteButton?.click());
    const confirm = container.querySelector<HTMLButtonElement>(
      "button[aria-label='confirm delete']",
    );
    await act(() => confirm?.click());

    const titleInput = container.querySelector<HTMLInputElement>("#book-delete-title");
    const finalDelete = container.querySelector<HTMLButtonElement>(
      ".book-delete-final-actions button[type='submit']",
    );
    // Destroying a book is gated on retyping its exact title, so a stray click
    // can't delete it.
    expect(finalDelete?.disabled, "delete stays disabled until the title matches").toBe(true);
    await act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(titleInput, "Book");
      titleInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(finalDelete?.disabled, "typing the matching title unlocks delete").toBe(false);
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

    // The fetched image is listed, but its preview is withheld until asked for
    // (these are hidden note images), then loads from the group image URL. A
    // broken URL join or an eager preview would both regress silently.
    expect(
      container.querySelector(".group-image-info"),
      "the uploaded image is listed",
    ).not.toBeNull();
    expect(
      container.querySelector(".group-image-preview"),
      "preview is withheld until viewed",
    ).toBeNull();

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
