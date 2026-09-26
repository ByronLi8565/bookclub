// @vitest-environment jsdom

import { Schema } from "effect";
import { Story } from "foldkit/test";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_USER_PREFS } from "../../shared/types/userPrefs.ts";
import {
  ApplyTheme,
  RememberUserPrefs,
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
  canSaveDisplayName,
  initialSettingsModel,
  restorePreviewSummary,
  updateSettings,
} from "../../client/foldkit/settings.ts";
import type { ClubProfile } from "../../shared/types/profiles.ts";

const profile: ClubProfile = { id: "reader-1", displayName: "Reader" };

const book = { groupId: "group-1" };

const groupRef = "parity-club-abc123";

describe("Foldkit settings stories", () => {
  it("opens on a hydrated prefs load and keeps a serializable Model", () => {
    Story.story(
      updateSettings,
      Story.given(initialSettingsModel()),
      Story.message(OpenedSettings()),
      Story.Command.expectExact(LoadUserPrefs({ revision: 0 })),
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
          revision: 0,
        }),
      ),
      Story.Command.resolve(ApplyTheme, CompletedSettingsAction()),
      Story.Command.resolve(RememberUserPrefs, CompletedSettingsAction()),
      Story.model((model) => {
        expect(model.prefs.reader.smartArrows).toBe("off");
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
        expect(model.notice).toEqual({
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
        expect(model.notice?.title).toBe("Photo updated");
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
        expect(model.notice?.title).toBe("Backup created");
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
        expect(model.notice).toEqual({
          title: "Notes restored",
          body: "Restored 3 notes and 1 image.",
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
        expect(model.notice).toEqual({
          title: "Restore failed",
          body: "No notes were replaced.",
          tone: "error",
        });
      }),
      Story.message(CancelledBackupRestore()),
      Story.model((model) => expect(model.restorePreview).toBeNull()),
    );
  });

  it("drops a server copy that was asked for before the reader's own change", () => {
    const stale = {
      ...DEFAULT_USER_PREFS,
      reader: { ...DEFAULT_USER_PREFS.reader, smartArrows: "instant" as const },
    };

    const [opened, loadCommands] = updateSettings(initialSettingsModel(), OpenedSettings());
    expect(loadCommands.map((command) => command.name)).toEqual([LoadUserPrefs.name]);
    const [toggled] = updateSettings(opened, ChoseSmartArrows({ value: "off" }));
    // The load went out before the toggle, so its answer predates it: nothing is
    // painted or written down from it.
    const [answered, commands] = updateSettings(
      toggled,
      LoadedUserPrefs({ prefs: stale, revision: 0 }),
    );
    expect(answered.prefs.reader.smartArrows).toBe("off");
    expect(commands).toEqual([]);
  });

  it("offers to save a nickname only once it really changed", () => {
    const initial = initialSettingsModel();
    expect(canSaveDisplayName(initial, profile)).toBe(false);
    expect(canSaveDisplayName({ ...initial, displayName: " Reader " }, profile)).toBe(false);
    expect(canSaveDisplayName({ ...initial, displayName: "   " }, profile)).toBe(false);
    expect(canSaveDisplayName({ ...initial, displayName: "Nick" }, profile)).toBe(true);
    // A save already in flight is not offered again.
    expect(canSaveDisplayName({ ...initial, displayName: "Nick", savingName: true }, profile)).toBe(
      false,
    );
  });

  it("counts what a restore would bring back in words that agree with the numbers", () => {
    const createdAt = "2026-08-15T00:00:00.000Z";
    expect(
      restorePreviewSummary({ clubName: "Parity Club", notes: 3, images: 1, createdAt }),
    ).toContain("Parity Club · 3 notes · 1 image · ");
    expect(
      restorePreviewSummary({ clubName: "Parity Club", notes: 1, images: 0, createdAt }),
    ).toContain("Parity Club · 1 note · 0 images · ");
  });
});

describe("settings category choice", () => {
  it("remembers the page the reader picked", () => {
    Story.story(
      updateSettings,
      Story.given(initialSettingsModel()),
      Story.message(ChoseSettingsCategory({ category: "reader" })),
      Story.model((model) => expect(model.category).toBe("reader")),
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
