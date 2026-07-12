// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBookclubArchive } from "../shared/backups/bookclubArchive.ts";
import { BackupControls } from "../client/ui/group/BackupControls.tsx";

describe("local notes backup settings", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("asks for confirmation before it downloads a backup", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        headers: new Headers({
          "Content-Type": "application/vnd.bookclub.backup+zip",
          "Content-Disposition": 'attachment; filename="readers.bookclub"',
        }),
        blob: () => Promise.resolve(new Blob(["x".repeat(1536)])),
      } as Response),
    );
    vi.stubGlobal("fetch", fetchMock);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    class TestUrl extends URL {
      static createObjectURL = vi.fn(() => "blob:backup");
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal("URL", TestUrl);
    await act(() => root.render(<BackupControls groupRef="club-ref" groupId="club-id" />));

    const backup = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Backup notes",
    );
    await act(async () => {
      backup?.click();
      await Promise.resolve();
    });

    expect(container.querySelector("[aria-label='Confirm notes backup']")?.textContent).toContain(
      "This will download a zip file of 1.5 KB with note data.",
    );
    expect(anchorClick).not.toHaveBeenCalled();
    const confirm = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Download",
    );
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
    });
    expect(anchorClick).toHaveBeenCalledOnce();
  });

  it("previews an exact restore before uploading it", async () => {
    const archive = await createBookclubArchive({
      createdAt: "2026-07-12T12:00:00.000Z",
      club: { id: "club-id", name: "Readers", publicId: "readers" },
      nextSeq: 2,
      books: [
        {
          sourceId: "book-id",
          title: "Book",
          meta: {
            kind: "epub",
            contentType: "application/epub+zip",
            size: 100,
            addedBy: "owner-id",
          },
        },
      ],
      notes: [
        {
          id: "note-id",
          seq: 1,
          sourceId: "book-id",
          author: { id: "owner-id", name: "Owner" },
          parent: null,
          body: "A note",
          highlights: [],
          createdAt: "2026-07-01T00:00:00.000Z",
          editedAt: null,
          deletedAt: null,
          version: 1,
        },
      ],
      images: [],
    });
    const fetchMock = vi.fn(() =>
      Promise.resolve(Response.json({ notes: 1, images: 0, createdAt: "2026-07-12T12:00:00Z" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    await act(() => root.render(<BackupControls groupRef="club-ref" groupId="club-id" />));

    const input = container.querySelector<HTMLInputElement>("input[type='file']");
    const file = new File([Uint8Array.from(archive).buffer], "readers.bookclub");
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    expect(container.querySelector(".settings-backup-preview")?.textContent).toContain(
      "Readers · 1 notes · 0 images",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    const restore = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Restore exactly",
    );
    await act(async () => {
      restore?.click();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith("/groups/club-ref/backup", {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
    expect(container.querySelector(".settings-backup-preview")).toBeNull();
  });
});
