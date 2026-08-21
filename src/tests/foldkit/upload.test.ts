// @vitest-environment jsdom

import { Runtime } from "foldkit";
import { Story } from "foldkit/test";
import { afterEach, describe, expect, it } from "vitest";
import {
  CancelledBookFieldEdit,
  ChangedBookFieldDraft,
  CommittedBookFieldEdit,
  CompletedBookInspection,
  DraggedOverBookDrop,
  FailedBookInspection,
  FailedBookUpload,
  InspectBook,
  LeftBookDrop,
  ProgressedBookInspection,
  SelectedBookFile,
  StartedBookFieldEdit,
  SubmittedBookUpload,
  UploadBook,
  UploadModel,
  UploadedBook,
  canUploadBook,
  initialUploadModel,
  isUploadMessage,
  updateUpload,
  uploadView,
  type InspectedBook,
  type UploadMessage,
} from "../../client/foldkit/upload.ts";

const group = { slug: "parity-club", publicId: "abc123" };
const groupRef = "parity-club-abc123";

const book: InspectedBook = {
  token: "book-token",
  fileName: "dorian-gray.epub",
  fileSize: 1024,
  kind: "epub",
  contentType: "application/epub+zip",
  title: "The Picture of Dorian Gray",
  author: "Oscar Wilde",
  wordCount: 1234,
  cover: null,
  health: {
    status: "ok",
    capabilities: {
      selectableText: true,
      textAnchors: true,
      rectAnchors: true,
      pageNavigation: false,
    },
    issues: [],
  },
};

const unreadable: InspectedBook = {
  ...book,
  health: {
    status: "error",
    capabilities: null,
    issues: [{ code: "no_text_layer", message: "This PDF has no text layer.", page: null }],
  },
};

const chosenFile = (): File =>
  new File(["book bytes"], "dorian-gray.epub", { type: "application/epub+zip" });

const ready = (inspected: InspectedBook = book): UploadModel => ({
  ...initialUploadModel(),
  status: "ready",
  inspected,
});

/** `Runtime.embed` replaces the container rather than filling it, so the tree
 *  lands in `document.body`. Assertions run against the live tree: `value` and
 *  `disabled` are DOM properties, and serialising the HTML would drop them. */
let disposeRendered: (() => void) | null = null;

afterEach(() => {
  disposeRendered?.();
  disposeRendered = null;
  document.body.innerHTML = "";
});

const render = async (model: UploadModel): Promise<HTMLElement> => {
  disposeRendered?.();
  document.body.innerHTML = "";
  const container = document.createElement("div");
  // The runtime mounts by container id; an id-less container is never replaced.
  container.id = "upload-view-test";
  document.body.appendChild(container);
  const handle = Runtime.embed(
    Runtime.makeElement<UploadModel, UploadMessage>({
      Model: UploadModel,
      container,
      init: () => [model, []],
      update: (current) => [current, []],
      // Closing is the host's message; the test only needs one that type-checks.
      view: (current, h) => uploadView(current, { group, onClose: LeftBookDrop() }, h),
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

describe("Foldkit upload stories", () => {
  it("recognises only its own messages", () => {
    expect(isUploadMessage(LeftBookDrop())).toBe(true);
    expect(isUploadMessage({ _tag: "ChangedNoteComposer" })).toBe(false);
  });

  it("inspects a chosen book and keeps the file out of the Model", () => {
    Story.story(
      updateUpload,
      Story.given(initialUploadModel()),
      Story.message(DraggedOverBookDrop()),
      Story.model((model) => expect(model.dragging).toBe(true)),
      Story.message(SelectedBookFile({ file: chosenFile() })),
      Story.model((model) => {
        expect(model.status).toBe("checking");
        expect(model.dragging).toBe(false);
        // A Model carrying a File would not survive this round trip.
        expect(JSON.parse(JSON.stringify(model))).toEqual(model);
      }),
      Story.Command.expectExact(InspectBook),
      Story.Command.resolve(InspectBook, CompletedBookInspection({ book })),
      Story.model((model) => {
        expect(model.status).toBe("ready");
        expect(model.inspected).toEqual(book);
        expect(canUploadBook(model)).toBe(true);
      }),
    );
  });

  it("follows the health check as it reads through the book", () => {
    Story.story(
      updateUpload,
      Story.given({ ...initialUploadModel(), status: "checking" }),
      Story.message(ProgressedBookInspection({ progress: 40 })),
      Story.model((model) => expect(model.progress).toBe(40)),
    );
  });

  it("reports the unsupported file the way the drop zone reads it", () => {
    Story.story(
      updateUpload,
      Story.given(initialUploadModel()),
      Story.message(SelectedBookFile({ file: chosenFile() })),
      Story.Command.resolve(InspectBook, FailedBookInspection({ reason: "unsupported_type" })),
      Story.model((model) => {
        expect(model.status).toBe("idle");
        expect(model.inspected).toBeNull();
        expect(model.error).toBe("Unsupported file — choose an EPUB or PDF.");
      }),
    );
  });

  it("renames the title in place and takes an emptied field as no title at all", () => {
    Story.story(
      updateUpload,
      Story.given(ready()),
      Story.message(StartedBookFieldEdit({ field: "title" })),
      Story.model((model) => expect(model.editDraft).toBe(book.title)),
      Story.message(ChangedBookFieldDraft({ value: "  Dorian Gray  " })),
      Story.message(CommittedBookFieldEdit()),
      Story.model((model) => {
        expect(model.inspected?.title).toBe("Dorian Gray");
        expect(model.editingField).toBeNull();
      }),
      Story.message(StartedBookFieldEdit({ field: "author" })),
      Story.message(ChangedBookFieldDraft({ value: "   " })),
      Story.message(CommittedBookFieldEdit()),
      Story.model((model) => expect(model.inspected?.author).toBeNull()),
      Story.message(StartedBookFieldEdit({ field: "title" })),
      Story.message(ChangedBookFieldDraft({ value: "abandoned" })),
      Story.message(CancelledBookFieldEdit()),
      Story.model((model) => expect(model.inspected?.title).toBe("Dorian Gray")),
    );
  });

  it("sends the inspected metadata with the file the inspection parked", () => {
    Story.story(
      updateUpload,
      Story.given(ready()),
      Story.message(SubmittedBookUpload({ groupRef })),
      Story.model((model) => expect(model.status).toBe("uploading")),
      Story.Command.expectExact(
        UploadBook({
          groupRef,
          token: book.token,
          title: book.title,
          author: book.author,
          wordCount: book.wordCount,
        }),
      ),
      Story.Command.resolve(UploadBook, UploadedBook({ sourceId: "source-hash" })),
      Story.model((model) => expect(model).toEqual(initialUploadModel())),
    );
  });

  it("leaves a failed upload ready to try again", () => {
    Story.story(
      updateUpload,
      Story.given(ready()),
      Story.message(SubmittedBookUpload({ groupRef })),
      Story.Command.resolve(UploadBook, FailedBookUpload({ message: "boom" })),
      Story.model((model) => {
        expect(model.status).toBe("ready");
        expect(model.inspected).toEqual(book);
      }),
    );
  });

  it("refuses to upload a book whose health came back as an error", () => {
    Story.story(
      updateUpload,
      Story.given(ready(unreadable)),
      Story.model((model) => expect(canUploadBook(model)).toBe(false)),
      Story.message(SubmittedBookUpload({ groupRef })),
      Story.Command.expectNone(),
      Story.model((model) => expect(model.status).toBe("ready")),
    );
  });
});

describe("the Foldkit upload modal", () => {
  it("draws the modal chrome the stylesheet expects", async () => {
    const tree = await render(initialUploadModel());

    expect(tree.querySelector(".modal-backdrop > dialog.modal.modal--upload[open]")).not.toBeNull();
    expect(tree.querySelector(".modal-inner > .modal-head strong")?.textContent).toBe("add a book");
    expect(tree.querySelector(".modal-inner > .modal-body.upload-body")).not.toBeNull();
    expect(tree.querySelector(".upload-drop > .upload-drop-icon")).not.toBeNull();
    expect(tree.querySelector(".upload-drop-label")?.textContent).toBe("attach book here");
    expect(tree.querySelector(".upload-drop-hint")?.textContent).toBe(
      "supported filetypes: pdf, epub",
    );
    const picker = tree.querySelector<HTMLInputElement>(".upload-drop input[type=file]");
    expect(picker?.getAttribute("accept")).toBe(".epub,application/epub+zip,.pdf,application/pdf");
    expect(picker?.hasAttribute("hidden")).toBe(true);
    expect(
      tree.querySelector<HTMLButtonElement>(".upload-actions .primary.upload-submit")?.disabled,
    ).toBe(true);
  });

  it("shows the health check running with its inline progress bar", async () => {
    const tree = await render({ ...initialUploadModel(), status: "checking", progress: 40 });

    expect(tree.querySelector(".upload-checking .loading.loading--inline")).not.toBeNull();
    expect(
      tree.querySelector<HTMLElement>(".upload-checking .loading-progress-fill")?.style.width,
    ).toBe("40%");
    expect(tree.querySelector(".upload-checking > span")?.textContent).toBe(
      "checking whether highlights will work…",
    );
  });

  it("tabulates the inspected book as the info table", async () => {
    const tree = await render(ready());

    expect(tree.querySelector(".upload-drop-label")?.textContent).toBe(book.fileName);
    expect(tree.querySelector(".upload-info > .upload-info-head")?.textContent).toBe("upload info");
    const rows = tree.querySelectorAll(".upload-info-table .upload-info-row");
    expect(rows).toHaveLength(8);
    expect(rows[0]?.querySelector("dt")?.textContent).toBe("Title");
    expect(rows[0]?.querySelector("dd span")?.getAttribute("title")).toBe(
      "Double-click to edit title",
    );
    expect(rows[2]?.textContent).toContain("1,234");
    expect(rows[3]?.textContent).toContain("1.0 KB");
    expect(tree.querySelectorAll(".upload-info-table .upload-status--ok")).toHaveLength(3);
    expect(tree.querySelectorAll(".upload-info-table .upload-status--error")).toHaveLength(1);
    expect(tree.querySelector<HTMLButtonElement>(".upload-actions .upload-submit")?.disabled).toBe(
      false,
    );
  });

  it("edits a title through the input the stylesheet names", async () => {
    const tree = await render({ ...ready(), editingField: "title", editDraft: "Dorian" });

    const input = tree.querySelector<HTMLInputElement>(".upload-info-table .upload-info-edit");
    expect(input?.getAttribute("aria-label")).toBe("title");
    expect(input?.value).toBe("Dorian");
  });

  it("marks the drop zone while a book is over it, and shows a failed check", async () => {
    const tree = await render({
      ...initialUploadModel(),
      dragging: true,
      error: "That file couldn't be read.",
    });

    expect(tree.querySelector(".upload-drop.is-dragging")).not.toBeNull();
    expect(tree.querySelector(".upload-error")?.textContent).toBe("That file couldn't be read.");
  });

  it("shows the cover in place of the icon and says the upload is running", async () => {
    const tree = await render({
      ...ready({ ...book, cover: "data:image/png;base64,cover" }),
      status: "uploading",
    });

    expect(tree.querySelector(".upload-drop > .upload-drop-icon")).toBeNull();
    expect(tree.querySelector<HTMLImageElement>(".upload-drop > img.upload-cover")?.src).toContain(
      "data:image/png;base64,cover",
    );
    const submit = tree.querySelector<HTMLButtonElement>(".upload-submit");
    expect(submit?.textContent).toBe("uploading…");
    expect(submit?.disabled).toBe(true);
  });
});
