// @vitest-environment jsdom

import { Schema } from "effect";
import { Runtime } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { Story } from "foldkit/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_USER_PREFS } from "../../shared/types/userPrefs.ts";
import {
  ApplyTheme,
  ArmedBackupDownloadMessage,
  AVATAR_INPUT_ID,
  BACKUP_INPUT_ID,
  CancelledBackupRestore,
  cachedUserPrefs,
  ChangedDisplayName,
  ChoseAvatarPhoto,
  ChoseOpeningPosition,
  ChosePdfPageLayout,
  ChoseRestoreFile,
  ChoseSettingsCategory,
  ChoseSmartArrows,
  ConfirmedBackupDownload,
  ConfirmedBackupRestore,
  CompletedSettingsAction,
  FailedSettingsAction,
  LoadUserPrefs,
  LoadedUserPrefs,
  OpenSettingsFilePicker,
  OpenedSettings,
  PrepareGroupBackup,
  PreviewBackupArchive,
  PreviewedBackup,
  RequestedBackupDownload,
  RestoreGroupBackup,
  RestoredBackup,
  SaveClubProfile,
  SaveGroupBackupFile,
  SaveUserPrefs,
  SavedBackupDownload,
  SavedClubProfile,
  SelectedAvatarImage,
  SelectedBackupFile,
  SettingsModel,
  SubmittedDisplayName,
  ToggledSettingsDropdown,
  ToggledShowAvatars,
  UploadAvatarImage,
  UploadedAvatar,
  backupControlsView,
  initialSettingsModel,
  settingsNotice,
  settingsPrefs,
  settingsView,
  updateSettings,
  type SettingsBook,
  type SettingsMessage,
} from "../../client/foldkit/settings.ts";
import type { ClubProfile } from "../../shared/types/profiles.ts";

const profile: ClubProfile = { id: "reader-1", displayName: "Reader" };

const book: SettingsBook = { groupId: "group-1", slug: "parity-club", publicId: "abc123", profile };

const groupRef = "parity-club-abc123";

/** `Runtime.embed` replaces the container rather than filling it, so the tree is
 *  captured from `document.body` before `dispose` tears it back down. */
const renderTree = async (
  view: (h: HtmlBuilder<SettingsMessage>) => Html,
  id: string,
): Promise<HTMLElement> => {
  const container = document.createElement("div");
  container.id = id;
  document.body.appendChild(container);
  const handle = Runtime.embed(
    Runtime.makeElement<SettingsModel, SettingsMessage>({
      Model: SettingsModel,
      container,
      init: () => [initialSettingsModel(), []],
      update: (current) => [current, []],
      view: (_current, h) => view(h),
      devTools: false,
      slow: false,
    }),
  );
  await new Promise((resolve) => {
    setTimeout(resolve, 200);
  });
  const html = document.body.innerHTML;
  handle.dispose();
  document.body.replaceChildren();
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return holder;
};

const renderSettings = (
  model: SettingsModel,
  context: { book: SettingsBook | null; signedIn?: boolean },
): Promise<HTMLElement> =>
  renderTree(
    (h) =>
      settingsView(
        model,
        {
          book: context.book,
          signedIn: context.signedIn ?? true,
          onClose: CompletedSettingsAction(),
        },
        h,
      ),
    "settings-view-test",
  );

const renderBackup = (model: SettingsModel): Promise<HTMLElement> =>
  renderTree((h) => backupControlsView(model, book, h), "backup-view-test");

describe("Foldkit settings stories", () => {
  it("opens on a hydrated prefs load and keeps a serializable Model", () => {
    Story.story(
      updateSettings,
      Story.given(initialSettingsModel()),
      Story.message(OpenedSettings()),
      Story.Command.expectExact(LoadUserPrefs()),
      Story.Command.resolve(
        LoadUserPrefs,
        LoadedUserPrefs({
          prefs: {
            reader: {
              smartArrows: "off",
              readingPositionOpenPolicy: "prefer-local",
              pdfPageLayout: "auto",
            },
            notes: { showAvatars: false, hashtagsAddTags: true, showHashtags: false },
            appearance: { themeId: "default" },
          },
        }),
      ),
      Story.Command.resolve(ApplyTheme, CompletedSettingsAction()),
      Story.model((model) => {
        expect(settingsPrefs(model).reader.smartArrows).toBe("off");
        expect(Schema.decodeUnknownSync(SettingsModel)(JSON.parse(JSON.stringify(model)))).toEqual(
          model,
        );
      }),
    );
  });

  it("writes one pref per control and syncs each change on its own", () => {
    Story.story(
      updateSettings,
      Story.given(initialSettingsModel()),
      Story.message(ToggledSettingsDropdown({ dropdown: "smartArrows" })),
      Story.model((model) => expect(model.openDropdown).toBe("smartArrows")),
      Story.message(ChoseSmartArrows({ value: "smooth" })),
      Story.model((model) => {
        // Choosing closes the menu, exactly as the React dropdown does.
        expect(model.openDropdown).toBeNull();
        expect(model.prefs.reader.smartArrows).toBe("smooth");
      }),
      Story.Command.resolve(SaveUserPrefs, CompletedSettingsAction()),
      Story.message(ChoseOpeningPosition({ value: "prefer-local" })),
      Story.Command.resolve(SaveUserPrefs, CompletedSettingsAction()),
      Story.message(ChosePdfPageLayout({ value: "auto" })),
      Story.Command.resolve(SaveUserPrefs, CompletedSettingsAction()),
      Story.message(ToggledShowAvatars({ value: false })),
      Story.Command.resolve(SaveUserPrefs, CompletedSettingsAction()),
      Story.model((model) => {
        // Every sibling field survives its neighbours being written.
        expect(model.prefs.reader).toEqual({
          smartArrows: "smooth",
          readingPositionOpenPolicy: "prefer-local",
          pdfPageLayout: "auto",
        });
        expect(model.prefs.notes).toEqual({
          showAvatars: false,
          hashtagsAddTags: true,
          showHashtags: true,
        });
      }),
    );
  });

  it("saves a nickname, then goes back to following the club profile", () => {
    Story.story(
      updateSettings,
      Story.given(initialSettingsModel()),
      Story.message(ChangedDisplayName({ value: "  Nick  " })),
      Story.model((model) => expect(model.displayName).toBe("  Nick  ")),
      Story.message(SubmittedDisplayName({ groupId: book.groupId, displayName: "  Nick  " })),
      Story.Command.expectExact(SaveClubProfile({ groupId: book.groupId, displayName: "Nick" })),
      Story.model((model) => expect(model.savingName).toBe(true)),
      Story.Command.resolve(
        SaveClubProfile,
        SavedClubProfile({ profile: { ...profile, displayName: "Nick" } }),
      ),
      Story.model((model) => {
        expect(model.savingName).toBe(false);
        expect(model.displayName).toBeNull();
        expect(settingsNotice(model)).toEqual({
          title: "Name updated",
          body: "You'll appear as Nick in this club.",
          tone: "info",
        });
      }),
    );
  });

  it("carries the avatar file in the Message and never in the Model", () => {
    const file = new File(["png"], "face.png", { type: "image/png" });

    Story.story(
      updateSettings,
      Story.given(initialSettingsModel()),
      Story.message(ChoseAvatarPhoto()),
      Story.Command.expectExact(OpenSettingsFilePicker({ inputId: AVATAR_INPUT_ID })),
      Story.Command.resolve(OpenSettingsFilePicker, CompletedSettingsAction()),
      Story.message(SelectedAvatarImage({ file })),
      Story.Command.expectExact(UploadAvatarImage),
      Story.model((model) => {
        expect(model.uploadingAvatar).toBe(true);
        expect(JSON.stringify(model)).not.toContain("face.png");
      }),
      Story.Command.resolve(UploadAvatarImage, UploadedAvatar({ imageId: "image-1" })),
      Story.model((model) => {
        expect(model.uploadingAvatar).toBe(false);
        expect(settingsNotice(model)?.title).toBe("Photo updated");
      }),
    );
  });

  it("arms a backup download before it saves anything", () => {
    Story.story(
      updateSettings,
      Story.given(initialSettingsModel()),
      Story.message(RequestedBackupDownload({ groupRef })),
      Story.Command.expectExact(PrepareGroupBackup({ groupRef })),
      Story.model((model) => expect(model.backupBusy).toBe("download")),
      Story.Command.resolve(
        PrepareGroupBackup,
        ArmedBackupDownloadMessage({ name: "notes.bookclub", size: 1536 }),
      ),
      Story.model((model) => {
        expect(model.backupBusy).toBeNull();
        expect(model.armedDownload).toEqual({ name: "notes.bookclub", size: 1536 });
      }),
      Story.message(ConfirmedBackupDownload()),
      Story.Command.expectExact(SaveGroupBackupFile()),
      Story.Command.resolve(SaveGroupBackupFile, SavedBackupDownload({ name: "notes.bookclub" })),
      Story.model((model) => {
        expect(model.armedDownload).toBeNull();
        expect(settingsNotice(model)?.title).toBe("Backup created");
      }),
    );
  });

  it("previews a restore against the club before it replaces anything", () => {
    const file = new File(["zip"], "notes.bookclub");

    Story.story(
      updateSettings,
      Story.given(initialSettingsModel()),
      Story.message(ChoseRestoreFile()),
      Story.Command.expectExact(OpenSettingsFilePicker({ inputId: BACKUP_INPUT_ID })),
      Story.Command.resolve(OpenSettingsFilePicker, CompletedSettingsAction()),
      Story.message(SelectedBackupFile({ groupId: book.groupId, file })),
      Story.Command.expectExact(PreviewBackupArchive),
      Story.Command.resolve(
        PreviewBackupArchive,
        PreviewedBackup({
          clubName: "Parity Club",
          notes: 3,
          images: 1,
          createdAt: "2026-08-15T00:00:00.000Z",
        }),
      ),
      Story.model((model) => expect(model.restorePreview?.notes).toBe(3)),
      Story.message(ConfirmedBackupRestore({ groupRef })),
      Story.Command.expectExact(RestoreGroupBackup({ groupRef })),
      Story.Command.resolve(RestoreGroupBackup, RestoredBackup({ notes: 3, images: 1 })),
      Story.model((model) => {
        expect(model.restorePreview).toBeNull();
        expect(settingsNotice(model)).toEqual({
          title: "Notes restored",
          body: "Restored 3 notes and 1 images.",
          tone: "info",
        });
      }),
    );
  });

  it("clears every busy flag when an action fails, and says why", () => {
    Story.story(
      updateSettings,
      Story.given({ ...initialSettingsModel(), backupBusy: "restore", restorePreview: null }),
      Story.message(
        FailedSettingsAction({ title: "Restore failed", body: "No notes were replaced." }),
      ),
      Story.model((model) => {
        expect(model.backupBusy).toBeNull();
        expect(settingsNotice(model)).toEqual({
          title: "Restore failed",
          body: "No notes were replaced.",
          tone: "error",
        });
      }),
      Story.message(CancelledBackupRestore()),
      Story.model((model) => expect(model.restorePreview).toBeNull()),
    );
  });
});

// The stylesheets apply through class names and nothing else, so a view with the
// right elements and the wrong classes is unstyled markup.
describe("the Foldkit settings modal", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 0),
    );
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("renders the modal chrome, the settings body, and the tab row", async () => {
    const tree = await renderSettings(initialSettingsModel(), { book });

    // A `<dialog>` without `open` is hidden by the UA stylesheet.
    expect(tree.querySelector(".modal-backdrop dialog.modal[open]")).not.toBeNull();
    expect(tree.querySelector(".modal-inner > .modal-head strong")?.textContent).toBe("settings");
    expect(tree.querySelector(".modal-inner > .modal-body.settings-body")).not.toBeNull();
    const tabs = tree.querySelectorAll(".pager-tabs.settings-tabs button");
    expect([...tabs].map((tab) => tab.textContent)).toEqual([
      "User",
      "General",
      "PDF",
      "Appearance",
    ]);
    expect(tabs[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(tabs[1]?.getAttribute("title")).toBe("General settings");
  });

  it("titles the account modal differently and always offers Appearance alongside it", async () => {
    const tree = await renderSettings(initialSettingsModel(), { book: null });

    expect(tree.querySelector(".modal-head strong")?.textContent).toBe("account settings");
    const tabs = tree.querySelectorAll(".pager-tabs.settings-tabs button");
    expect([...tabs].map((tab) => tab.textContent)).toEqual(["Account", "Appearance"]);
  });

  it("shows no tab row for a signed-out reader with no book, past Appearance", async () => {
    const tree = await renderSettings(initialSettingsModel(), { book: null, signedIn: false });

    expect(tree.querySelector(".pager-tabs")).toBeNull();
  });

  it("draws the user page as the profile grid and the nickname form", async () => {
    const tree = await renderSettings(initialSettingsModel(), { book });

    const avatar = tree.querySelector(".settings-item.settings-user-profile .settings-user-avatar");
    expect(avatar?.getAttribute("aria-label")).toBe("Profile picture");
    expect(avatar?.querySelector("span")?.textContent).toBe("R");
    const photo = tree.querySelector(".settings-user-profile .settings-item-control");
    expect(photo?.querySelector(`input#${AVATAR_INPUT_ID}[type="file"]`)).not.toBeNull();
    expect(photo?.querySelector("button.settings-action")?.textContent).toBe("Choose photo");

    const form = tree.querySelector(".settings-item--stacked form.settings-text-submit-form");
    expect(form?.querySelector('input[aria-label="Display name"]')).not.toBeNull();
    const save = form?.querySelector("button.settings-action.settings-text-submit-button");
    expect(save?.getAttribute("title")).toBe("Save display name (Enter)");
    // Nothing to save while the field still matches the club profile.
    expect(save?.hasAttribute("disabled")).toBe(true);
  });

  it("shows the stored avatar rather than the initial once one exists", async () => {
    const tree = await renderSettings(initialSettingsModel(), {
      book: { ...book, profile: { ...profile, avatarImageId: "image-1" } },
    });

    expect(tree.querySelector(".settings-user-avatar img")?.getAttribute("src")).toBe(
      "/users/reader-1/avatar/image-1",
    );
  });

  it("enables the nickname save only once the name really changed", async () => {
    const tree = await renderSettings({ ...initialSettingsModel(), displayName: "Nick" }, { book });

    expect(tree.querySelector(".settings-text-submit-button")?.hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("draws the general page as one dropdown row and three checkbox rows", async () => {
    const tree = await renderSettings({ ...initialSettingsModel(), category: "general" }, { book });

    const row = tree.querySelector(".settings-body > section.settings-item");
    expect(row?.querySelector(".settings-item-text > .settings-item-head")?.textContent).toBe(
      "Opening position",
    );
    expect(row?.querySelector(".settings-item-desc")?.textContent).toBe(
      "Whether to sync reading position across browsers",
    );
    const trigger = row?.querySelector(
      ".settings-item-control > .book-menu.settings-dropdown > .settings-action.settings-dropdown-trigger",
    );
    expect(trigger?.getAttribute("aria-label")).toBe("Opening reading position");
    expect(trigger?.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger?.querySelector("span")?.textContent).toBe("Sync");
    expect(trigger?.querySelector(".book-menu-arrow")?.textContent).toBe("▾");
    // The menu is closed until the trigger is pressed.
    expect(tree.querySelector(".book-menu-list")).toBeNull();

    const checkboxes = tree.querySelectorAll("label.settings-item.settings-item--checkbox");
    expect([...checkboxes].map((item) => item.querySelector(".settings-item-head")?.textContent)) //
      .toEqual(["Show profile pics", "Hashtags add tags", "Show hashtags"]);
    expect(checkboxes[0]?.querySelector('input.settings-checkbox[type="checkbox"]')).not.toBeNull();
  });

  it("opens a dropdown as the shared book menu, marking the chosen option", async () => {
    const tree = await renderSettings(
      { ...initialSettingsModel(), category: "general", openDropdown: "readingPositionOpenPolicy" },
      { book },
    );

    const items = tree.querySelectorAll('ul.book-menu-list[role="menu"] > li[role="none"]');
    expect(items).toHaveLength(2);
    const active = items[0]?.querySelector("button");
    expect(active?.getAttribute("class")).toBe("book-menu-item is-active");
    expect(active?.getAttribute("aria-checked")).toBe("true");
    expect(items[1]?.querySelector("button")?.getAttribute("class")).toBe("book-menu-item");
  });

  it("draws the PDF page as the two reader dropdowns", async () => {
    const tree = await renderSettings({ ...initialSettingsModel(), category: "pdf" }, { book });

    const heads = [...tree.querySelectorAll(".settings-item-head")].map((h2) => h2.textContent);
    expect(heads).toEqual(["Page layout", "Smart arrow keys"]);
    const triggers = tree.querySelectorAll(".settings-dropdown-trigger");
    expect(triggers[0]?.getAttribute("aria-label")).toBe("PDF page layout");
    expect(triggers[0]?.querySelector("span")?.textContent).toBe("Single page");
    expect(triggers[1]?.getAttribute("aria-label")).toBe("PDF smart arrow keys");
    expect(triggers[1]?.querySelector("span")?.textContent).toBe("Instant");
  });

  it("falls back to the first page when the stored one is not on offer", async () => {
    // "pdf" is not a page of the account modal, so the account page shows.
    const tree = await renderSettings(
      { ...initialSettingsModel(), category: "pdf" },
      { book: null },
    );

    expect(tree.querySelector(".settings-body")?.children).toHaveLength(0);
  });

  it("still offers Appearance, with no tab row, for a signed-out reader with no book", async () => {
    const tree = await renderSettings(initialSettingsModel(), { book: null, signedIn: false });

    expect(tree.querySelector(".settings-body")?.children.length).toBeGreaterThan(0);
    expect(tree.querySelector(".theme-swatch-grid")).not.toBeNull();
    expect(tree.querySelector(".pager-tabs")).toBeNull();
  });

  it("puts the host's account markup on the account page", async () => {
    const tree = await renderTree(
      (h) =>
        settingsView(
          initialSettingsModel(),
          {
            book: null,
            signedIn: true,
            onClose: CompletedSettingsAction(),
            accountSection: [h.p([h.Class("account-passkey")], ["host account markup"])],
          },
          h,
        ),
      "settings-account-test",
    );

    expect(tree.querySelector(".settings-body > .account-passkey")?.textContent).toBe(
      "host account markup",
    );
  });
});

describe("the Foldkit backup controls", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 0),
    );
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("draws the two actions and the hidden archive picker", async () => {
    const tree = await renderBackup(initialSettingsModel());

    const actions = tree.querySelectorAll(
      ".group-backup-controls > .settings-backup-actions > button.settings-action",
    );
    expect([...actions].map((button) => button.textContent)).toEqual([
      "Backup notes",
      "Restore notes",
    ]);
    expect(actions[0]?.hasAttribute("disabled")).toBe(false);
    const picker = tree.querySelector(`input#${BACKUP_INPUT_ID}`);
    expect(picker?.getAttribute("accept")).toBe(".bookclub,application/vnd.bookclub.backup+zip");
  });

  it("says it is working and locks both actions while it does", async () => {
    const tree = await renderBackup({ ...initialSettingsModel(), backupBusy: "download" });

    const actions = tree.querySelectorAll(".settings-backup-actions > button");
    expect(actions[0]?.textContent).toBe("creating…");
    expect(actions[0]?.hasAttribute("disabled")).toBe(true);
    expect(actions[1]?.hasAttribute("disabled")).toBe(true);
  });

  it("confirms the download in an open dialog that names its size", async () => {
    const tree = await renderBackup({
      ...initialSettingsModel(),
      armedDownload: { name: "notes.bookclub", size: 1536 },
    });

    const dialog = tree.querySelector("dialog.backup-download-confirm[open]");
    expect(dialog?.getAttribute("aria-label")).toBe("Confirm notes backup");
    expect(dialog?.querySelector("p")?.textContent).toBe(
      "This will download note data into a zip file of 1.5 KB.",
    );
    const buttons = dialog?.querySelectorAll(".settings-backup-actions > button");
    expect(buttons?.[0]?.textContent).toBe("Cancel");
    expect(buttons?.[1]?.getAttribute("class")).toBe("settings-action settings-backup-restore");
    expect(buttons?.[1]?.textContent).toBe("Download");
  });

  it("spells out what a restore would replace before it offers to do it", async () => {
    const tree = await renderBackup({
      ...initialSettingsModel(),
      restorePreview: {
        clubName: "Parity Club",
        notes: 3,
        images: 1,
        createdAt: "2026-08-15T00:00:00.000Z",
      },
    });

    const preview = tree.querySelector('.settings-backup-preview[role="status"]');
    expect(preview?.querySelector("strong")?.textContent).toBe("Replace all current notes?");
    expect(preview?.querySelector("span")?.textContent).toContain(
      "Parity Club · 3 notes · 1 images",
    );
    expect(preview?.querySelector("p")?.textContent).toContain("cannot be undone");
    const buttons = preview?.querySelectorAll(".settings-backup-actions > button");
    expect(buttons?.[1]?.textContent).toBe("Restore exactly");
    expect(buttons?.[1]?.getAttribute("class")).toBe("settings-action settings-backup-restore");
  });

  it("reads restoring as its own busy word", async () => {
    const tree = await renderBackup({
      ...initialSettingsModel(),
      backupBusy: "restore",
      restorePreview: {
        clubName: "Parity Club",
        notes: 3,
        images: 1,
        createdAt: "2026-08-15T00:00:00.000Z",
      },
    });

    const buttons = tree.querySelectorAll(".settings-backup-preview button");
    expect(buttons[1]?.textContent).toBe("restoring…");
    expect(buttons[1]?.hasAttribute("disabled")).toBe(true);
  });
});

describe("settings category choice", () => {
  it("remembers the page the reader picked", () => {
    Story.story(
      updateSettings,
      Story.given(initialSettingsModel()),
      Story.message(ChoseSettingsCategory({ category: "pdf" })),
      Story.model((model) => expect(model.category).toBe("pdf")),
    );
  });
});

describe("preferences outlive the round trip that shares them", () => {
  beforeEach(() => localStorage.clear());

  it("starts from the reader's own settings rather than the defaults", () => {
    // React wrote this key, so a reader who set a preference before the cutover
    // still has it afterwards — and has it on the first paint, with no
    // connection, instead of watching the page flip when /me/prefs answers.
    localStorage.setItem(
      "bookclub.userPrefs:v1",
      JSON.stringify({ reader: { pdfPageLayout: "single" } }),
    );
    expect(cachedUserPrefs().reader.pdfPageLayout).toBe("single");
    expect(initialSettingsModel().prefs.reader.pdfPageLayout).toBe("single");
  });

  it("falls back to the defaults when nothing was stored", () => {
    expect(cachedUserPrefs()).toEqual(DEFAULT_USER_PREFS);
  });
});
