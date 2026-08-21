import { Effect, Schema, Stream } from "effect";
import { Command } from "foldkit";
import * as FoldkitFile from "foldkit/file";
import type { Html, HtmlBuilder } from "foldkit/html";
import { m } from "foldkit/message";
import {
  BOOKCLUB_ARCHIVE_CONTENT_TYPE,
  BOOKCLUB_ARCHIVE_EXTENSION,
} from "../../shared/backups/bookclubArchive.ts";
import { formatBytes } from "../../shared/format.ts";
import { groupUrlName } from "../../shared/groupUrls.ts";
import { UPLOAD_FILE_FIELD } from "../../shared/http/uploads.ts";
import { ClubProfile, MAX_DISPLAY_NAME_LENGTH } from "../../shared/types/profiles.ts";
import { decode } from "../../shared/schema.ts";
import {
  DEFAULT_USER_PREFS,
  PdfPageLayout,
  ReadingPositionOpenPolicy,
  SmartArrows,
  UserPrefs,
  UserPrefsPatch,
  mergeUserPrefs,
} from "../../shared/types/userPrefs.ts";
import { previewGroupBackup, saveGroupBackup } from "../logic/groups/backupAccess.ts";
import { avatarImagePath, avatarInitial } from "../logic/groups/groupClient.ts";
import { isNative } from "../logic/net/api.ts";
import { readVersionedLocal, writeLocal } from "../logic/storage.ts";
import { bookclubClient } from "../logic/net/bookclubClient.ts";
import { modalTabsView, modalView } from "./modal.ts";

/**
 * React reaches its hidden file inputs through refs, which a Foldkit view has
 * no equivalent for; the picker is opened by id from a Command instead. No
 * stylesheet selects on either id.
 */
export const AVATAR_INPUT_ID = "settings-avatar-input";
export const BACKUP_INPUT_ID = "settings-backup-input";

/**
 * A backup File is far too big to sit in the Model and has to survive the
 * confirmation step that stands between choosing it and using it, so the two
 * flows park their one in-flight file here — the same way the note editor holds
 * an image while its upload settles. Only one download and one restore can be
 * armed at a time, which is what makes the two fixed keys enough.
 */
const armedBackupFiles = new Map<"download" | "restore", File>();

export const SettingsCategory = Schema.Literals(["account", "user", "general", "pdf"]);
export type SettingsCategory = typeof SettingsCategory.Type;

export const SettingsNotice = Schema.Struct({
  title: Schema.String,
  body: Schema.String,
  tone: Schema.Literals(["info", "error"]),
});
export type SettingsNotice = typeof SettingsNotice.Type;

const ArmedBackupDownload = Schema.Struct({ name: Schema.String, size: Schema.Number });

const BackupRestorePreview = Schema.Struct({
  clubName: Schema.String,
  notes: Schema.Number,
  images: Schema.Number,
  createdAt: Schema.String,
});

export const SettingsModel = Schema.Struct({
  /**
   * Null until the reader picks a page, because which pages exist depends on
   * whether a book is open — knowledge the view has and the Model does not.
   * React's `useState(categories[0]?.id)` reads the same way.
   */
  category: Schema.NullOr(SettingsCategory),
  prefs: UserPrefs,
  /** Which settings dropdown is showing its menu, by the id the view gives it. */
  openDropdown: Schema.NullOr(Schema.String),
  /** Null while the nickname field is untouched, so it follows the club profile
   *  the host passes in, exactly like React's `useEffect` resync. */
  displayName: Schema.NullOr(Schema.String),
  savingName: Schema.Boolean,
  uploadingAvatar: Schema.Boolean,
  backupBusy: Schema.NullOr(Schema.Literals(["download", "restore"])),
  armedDownload: Schema.NullOr(ArmedBackupDownload),
  restorePreview: Schema.NullOr(BackupRestorePreview),
  /** React spawns a toast; toasts are page chrome the host owns, so the sentence
   *  is published here for the host to render. */
  notice: Schema.NullOr(SettingsNotice),
});
export type SettingsModel = typeof SettingsModel.Type;

const PREFS_KEY = "bookclub.userPrefs:v1";
const LEGACY_PREFS_KEY = "bookclub.userPrefs";

/**
 * Preferences are local-first, as React's were, and under the same key — so a
 * reader's settings survive the cutover, apply on the first paint instead of
 * flipping when `/me/prefs` answers, and still apply with no connection at all.
 * The server copy is what makes them follow the reader between devices.
 */
export const cachedUserPrefs = (): UserPrefs =>
  mergeUserPrefs(
    decode(UserPrefsPatch, readVersionedLocal<unknown>(PREFS_KEY, LEGACY_PREFS_KEY)) ??
      DEFAULT_USER_PREFS,
  );

const rememberUserPrefs = (prefs: UserPrefs): Effect.Effect<void> =>
  Effect.sync(() => {
    writeLocal(PREFS_KEY, prefs);
  });

export const initialSettingsModel = (): SettingsModel => ({
  category: null,
  prefs: cachedUserPrefs(),
  openDropdown: null,
  displayName: null,
  savingName: false,
  uploadingAvatar: false,
  backupBusy: null,
  armedDownload: null,
  restorePreview: null,
  notice: null,
});

export const OpenedSettings = m("OpenedSettings");
export const ChoseSettingsCategory = m("ChoseSettingsCategory", { category: SettingsCategory });
export const ToggledSettingsDropdown = m("ToggledSettingsDropdown", { dropdown: Schema.String });
export const LoadedUserPrefs = m("LoadedUserPrefs", { prefs: UserPrefs });
export const ChoseOpeningPosition = m("ChoseOpeningPosition", { value: ReadingPositionOpenPolicy });
export const ChosePdfPageLayout = m("ChosePdfPageLayout", { value: PdfPageLayout });
export const ChoseSmartArrows = m("ChoseSmartArrows", { value: SmartArrows });
export const ToggledShowAvatars = m("ToggledShowAvatars", { value: Schema.Boolean });
export const ToggledHashtagsAddTags = m("ToggledHashtagsAddTags", { value: Schema.Boolean });
export const ToggledShowHashtags = m("ToggledShowHashtags", { value: Schema.Boolean });
export const ChangedDisplayName = m("ChangedDisplayName", { value: Schema.String });
export const SubmittedDisplayName = m("SubmittedDisplayName", {
  groupId: Schema.String,
  displayName: Schema.String,
});
export const SavedClubProfile = m("SavedClubProfile", { profile: ClubProfile });
export const ChoseAvatarPhoto = m("ChoseAvatarPhoto");
export const SelectedAvatarImage = m("SelectedAvatarImage", { file: FoldkitFile.File });
export const UploadedAvatar = m("UploadedAvatar", { imageId: Schema.String });
export const RequestedBackupDownload = m("RequestedBackupDownload", { groupRef: Schema.String });
export const ArmedBackupDownloadMessage = m("ArmedBackupDownloadMessage", {
  name: Schema.String,
  size: Schema.Number,
});
export const CancelledBackupDownload = m("CancelledBackupDownload");
export const ConfirmedBackupDownload = m("ConfirmedBackupDownload");
export const SavedBackupDownload = m("SavedBackupDownload", { name: Schema.String });
export const ChoseRestoreFile = m("ChoseRestoreFile");
export const SelectedBackupFile = m("SelectedBackupFile", {
  groupId: Schema.String,
  file: FoldkitFile.File,
});
export const PreviewedBackup = m("PreviewedBackup", {
  clubName: Schema.String,
  notes: Schema.Number,
  images: Schema.Number,
  createdAt: Schema.String,
});
export const CancelledBackupRestore = m("CancelledBackupRestore");
export const ConfirmedBackupRestore = m("ConfirmedBackupRestore", { groupRef: Schema.String });
export const RestoredBackup = m("RestoredBackup", { notes: Schema.Number, images: Schema.Number });
export const DismissedSettingsNotice = m("DismissedSettingsNotice");
export const CompletedSettingsAction = m("CompletedSettingsAction");
export const FailedSettingsAction = m("FailedSettingsAction", {
  title: Schema.String,
  body: Schema.String,
});

export const SettingsMessage = Schema.Union([
  OpenedSettings,
  ChoseSettingsCategory,
  ToggledSettingsDropdown,
  LoadedUserPrefs,
  ChoseOpeningPosition,
  ChosePdfPageLayout,
  ChoseSmartArrows,
  ToggledShowAvatars,
  ToggledHashtagsAddTags,
  ToggledShowHashtags,
  ChangedDisplayName,
  SubmittedDisplayName,
  SavedClubProfile,
  ChoseAvatarPhoto,
  SelectedAvatarImage,
  UploadedAvatar,
  RequestedBackupDownload,
  ArmedBackupDownloadMessage,
  CancelledBackupDownload,
  ConfirmedBackupDownload,
  SavedBackupDownload,
  ChoseRestoreFile,
  SelectedBackupFile,
  PreviewedBackup,
  CancelledBackupRestore,
  ConfirmedBackupRestore,
  RestoredBackup,
  DismissedSettingsNotice,
  CompletedSettingsAction,
  FailedSettingsAction,
]);
export type SettingsMessage = typeof SettingsMessage.Type;

export const isSettingsMessage = Schema.is(SettingsMessage);

export const LoadUserPrefs = Command.define("LoadUserPrefs", {
  messages: [LoadedUserPrefs, CompletedSettingsAction],
  execute: bookclubClient.pipe(
    Effect.flatMap((client) => client.accounts.prefs({})),
    Effect.tap(({ prefs }) => rememberUserPrefs(prefs)),
    Effect.map(({ prefs }) => LoadedUserPrefs({ prefs })),
    // React keeps whatever it already had when the round trip fails, silently.
    Effect.catch(() => Effect.succeed(CompletedSettingsAction())),
  ),
});

/** A run of toggles is one intent, so an older sync is interrupted rather than
 *  raced, the way `startSync` interrupts its fiber. */
export const SaveUserPrefs = Command.define("SaveUserPrefs", {
  args: { prefs: UserPrefs },
  messages: [CompletedSettingsAction],
  interrupt: true,
  execute: ({ prefs }) =>
    // The local copy is written first and unconditionally: a toggle has to hold
    // even when the round trip that shares it does not.
    rememberUserPrefs(prefs).pipe(
      Effect.andThen(bookclubClient),
      Effect.flatMap((client) => client.accounts.setPrefs({ payload: { prefs } })),
      Effect.as(CompletedSettingsAction()),
      Effect.catch(() => Effect.succeed(CompletedSettingsAction())),
    ),
});

/**
 * The path segment is spelled `groupRef`, but the handler addresses the club's
 * agent by it, so what it wants is the `groupId` — this is the one club call
 * that is not a slug-publicId reference.
 */
export const SaveClubProfile = Command.define("SaveClubProfile", {
  args: { groupId: Schema.String, displayName: Schema.String },
  messages: [SavedClubProfile, FailedSettingsAction],
  execute: ({ groupId, displayName }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) =>
        client.accounts.setClubProfile({ params: { groupRef: groupId }, payload: { displayName } }),
      ),
      Effect.map(({ profile }) => SavedClubProfile({ profile })),
      Effect.catch(() =>
        Effect.succeed(
          FailedSettingsAction({
            title: "Name update failed",
            body: "Couldn't update your name for this club.",
          }),
        ),
      ),
    ),
});

export const UploadAvatarImage = Command.define("UploadAvatarImage", {
  args: { file: FoldkitFile.File },
  messages: [UploadedAvatar, FailedSettingsAction],
  execute: ({ file }) => {
    const payload = new FormData();
    payload.append(UPLOAD_FILE_FIELD, file);
    return bookclubClient.pipe(
      Effect.flatMap((client) => client.accounts.uploadAvatar({ payload })),
      Effect.map(({ id }) => UploadedAvatar({ imageId: id })),
      Effect.catch(() =>
        Effect.succeed(
          FailedSettingsAction({
            title: "Photo upload failed",
            body: "Try a smaller image or a different file.",
          }),
        ),
      ),
    );
  },
});

export const OpenSettingsFilePicker = Command.define("OpenSettingsFilePicker", {
  args: { inputId: Schema.String },
  messages: [CompletedSettingsAction],
  execute: ({ inputId }) =>
    Effect.sync(() => {
      const input = globalThis.document.getElementById(inputId);
      if (input instanceof HTMLInputElement) input.click();
      return CompletedSettingsAction();
    }),
});

/** The archive is built server-side and only then offered, so the reader is told
 *  how big the download is before it starts. */
export const PrepareGroupBackup = Command.define("PrepareGroupBackup", {
  args: { groupRef: Schema.String },
  messages: [ArmedBackupDownloadMessage, FailedSettingsAction],
  execute: ({ groupRef }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.groups.exportBackup({ params: { groupRef } })),
      Effect.flatMap((stream) => Stream.runCollect(stream)),
      Effect.map((chunks) => {
        // SAFETY: the response stream yields Uint8Array chunks backed by ArrayBuffer, not SharedArrayBuffer.
        const parts = [...chunks] as BlobPart[];
        const file = new File(parts, `notes${BOOKCLUB_ARCHIVE_EXTENSION}`, {
          type: BOOKCLUB_ARCHIVE_CONTENT_TYPE,
        });
        armedBackupFiles.set("download", file);
        return ArmedBackupDownloadMessage({ name: file.name, size: file.size });
      }),
      Effect.catch(() =>
        Effect.succeed(
          FailedSettingsAction({
            title: "Backup failed",
            body: "Couldn't create the notes backup.",
          }),
        ),
      ),
    ),
});

export const SaveGroupBackupFile = Command.define("SaveGroupBackupFile", {
  messages: [SavedBackupDownload, FailedSettingsAction],
  execute: Effect.suspend(() => {
    const file = armedBackupFiles.get("download");
    if (file === undefined) {
      return Effect.succeed(
        FailedSettingsAction({ title: "Backup failed", body: "Couldn't save the notes backup." }),
      );
    }
    return Effect.promise(() => saveGroupBackup(file)).pipe(
      Effect.map((result) => {
        if (!result.ok) {
          return FailedSettingsAction({
            title: "Backup failed",
            body: "Couldn't save the notes backup.",
          });
        }
        armedBackupFiles.delete("download");
        return SavedBackupDownload({ name: result.value.name });
      }),
    );
  }),
});

/** A chosen archive is decoded and checked against the club it would land in
 *  before anything is offered to replace. */
export const PreviewBackupArchive = Command.define("PreviewBackupArchive", {
  args: { groupId: Schema.String, file: FoldkitFile.File },
  messages: [PreviewedBackup, FailedSettingsAction],
  execute: ({ groupId, file }) =>
    Effect.promise(() => previewGroupBackup(file)).pipe(
      Effect.map((result) => {
        if (!result.ok) {
          return FailedSettingsAction({
            title: "Invalid backup",
            body: "This file isn't a supported Bookclub backup.",
          });
        }
        const { manifest } = result.value;
        if (manifest.club.id !== groupId) {
          return FailedSettingsAction({
            title: "Different club",
            body: "This backup belongs to a different club.",
          });
        }
        armedBackupFiles.set("restore", file);
        return PreviewedBackup({
          clubName: manifest.club.name,
          notes: manifest.notes.length,
          images: manifest.images.length,
          createdAt: manifest.createdAt,
        });
      }),
    ),
});

export const RestoreGroupBackup = Command.define("RestoreGroupBackup", {
  args: { groupRef: Schema.String },
  messages: [RestoredBackup, FailedSettingsAction],
  execute: ({ groupRef }) =>
    Effect.suspend(() => {
      const file = armedBackupFiles.get("restore");
      if (file === undefined) {
        return Effect.succeed(
          FailedSettingsAction({ title: "Restore failed", body: "No notes were replaced." }),
        );
      }
      const payload = new FormData();
      payload.append(UPLOAD_FILE_FIELD, file);
      return bookclubClient.pipe(
        Effect.flatMap((client) => client.groups.restoreBackup({ params: { groupRef }, payload })),
        Effect.map(({ notes, images }) => {
          armedBackupFiles.delete("restore");
          return RestoredBackup({ notes, images });
        }),
        Effect.catch(() =>
          Effect.succeed(
            FailedSettingsAction({ title: "Restore failed", body: "No notes were replaced." }),
          ),
        ),
      );
    }),
});

export type SettingsCommand =
  | ReturnType<typeof LoadUserPrefs>
  | ReturnType<typeof SaveUserPrefs>
  | ReturnType<typeof SaveClubProfile>
  | ReturnType<typeof UploadAvatarImage>
  | ReturnType<typeof OpenSettingsFilePicker>
  | ReturnType<typeof PrepareGroupBackup>
  | ReturnType<typeof SaveGroupBackupFile>
  | ReturnType<typeof PreviewBackupArchive>
  | ReturnType<typeof RestoreGroupBackup>;

type Fold = readonly [SettingsModel, readonly SettingsCommand[]];

const savedReaderPref = (model: SettingsModel, reader: UserPrefs["reader"]): Fold => {
  const prefs = { ...model.prefs, reader };
  return [{ ...model, prefs, openDropdown: null }, [SaveUserPrefs({ prefs })]];
};

const savedNotesPref = (model: SettingsModel, notes: UserPrefs["notes"]): Fold => {
  const prefs = { ...model.prefs, notes };
  return [{ ...model, prefs }, [SaveUserPrefs({ prefs })]];
};

const notified = (
  model: SettingsModel,
  notice: { readonly title: string; readonly body: string; readonly tone?: "info" | "error" },
): SettingsModel => ({
  ...model,
  notice: { title: notice.title, body: notice.body, tone: notice.tone ?? "info" },
  savingName: false,
  uploadingAvatar: false,
  backupBusy: null,
});

export const updateSettings = (model: SettingsModel, message: SettingsMessage): Fold => {
  switch (message._tag) {
    case "OpenedSettings":
      return [
        { ...initialSettingsModel(), prefs: model.prefs },
        // React's prefs store hydrates from the server whenever it is read.
        [LoadUserPrefs()],
      ];
    case "ChoseSettingsCategory":
      return [{ ...model, category: message.category, openDropdown: null }, []];
    case "ToggledSettingsDropdown":
      return [
        {
          ...model,
          openDropdown: model.openDropdown === message.dropdown ? null : message.dropdown,
        },
        [],
      ];
    case "LoadedUserPrefs":
      return [{ ...model, prefs: message.prefs }, []];
    case "ChoseOpeningPosition":
      return savedReaderPref(model, {
        ...model.prefs.reader,
        readingPositionOpenPolicy: message.value,
      });
    case "ChosePdfPageLayout":
      return savedReaderPref(model, { ...model.prefs.reader, pdfPageLayout: message.value });
    case "ChoseSmartArrows":
      return savedReaderPref(model, { ...model.prefs.reader, smartArrows: message.value });
    case "ToggledShowAvatars":
      return savedNotesPref(model, { ...model.prefs.notes, showAvatars: message.value });
    case "ToggledHashtagsAddTags":
      return savedNotesPref(model, { ...model.prefs.notes, hashtagsAddTags: message.value });
    case "ToggledShowHashtags":
      return savedNotesPref(model, { ...model.prefs.notes, showHashtags: message.value });
    case "ChangedDisplayName":
      return [{ ...model, displayName: message.value }, []];
    case "SubmittedDisplayName": {
      const displayName = message.displayName.trim();
      if (displayName === "") return [model, []];
      return [
        { ...model, savingName: true },
        [SaveClubProfile({ groupId: message.groupId, displayName })],
      ];
    }
    case "SavedClubProfile":
      return [
        {
          ...notified(model, {
            title: "Name updated",
            body: `You'll appear as ${message.profile.displayName} in this club.`,
          }),
          // The field goes back to following the profile the host now holds.
          displayName: null,
        },
        [],
      ];
    case "ChoseAvatarPhoto":
      return [model, [OpenSettingsFilePicker({ inputId: AVATAR_INPUT_ID })]];
    case "SelectedAvatarImage":
      return [{ ...model, uploadingAvatar: true }, [UploadAvatarImage({ file: message.file })]];
    case "UploadedAvatar":
      return [
        notified(model, {
          title: "Photo updated",
          body: "Your profile picture is now visible in your clubs.",
        }),
        [],
      ];
    case "RequestedBackupDownload":
      return [
        { ...model, backupBusy: "download" },
        [PrepareGroupBackup({ groupRef: message.groupRef })],
      ];
    case "ArmedBackupDownloadMessage":
      return [
        { ...model, backupBusy: null, armedDownload: { name: message.name, size: message.size } },
        [],
      ];
    case "CancelledBackupDownload":
      return [{ ...model, armedDownload: null }, []];
    case "ConfirmedBackupDownload":
      return [{ ...model, backupBusy: "download" }, [SaveGroupBackupFile()]];
    case "SavedBackupDownload":
      return [
        {
          ...notified(model, {
            title: "Backup created",
            body: isNative
              ? `${message.name} was saved to Documents.`
              : `${message.name} downloaded.`,
          }),
          armedDownload: null,
        },
        [],
      ];
    case "ChoseRestoreFile":
      return [model, [OpenSettingsFilePicker({ inputId: BACKUP_INPUT_ID })]];
    case "SelectedBackupFile":
      return [model, [PreviewBackupArchive({ groupId: message.groupId, file: message.file })]];
    case "PreviewedBackup":
      return [
        {
          ...model,
          restorePreview: {
            clubName: message.clubName,
            notes: message.notes,
            images: message.images,
            createdAt: message.createdAt,
          },
        },
        [],
      ];
    case "CancelledBackupRestore":
      return [{ ...model, restorePreview: null }, []];
    case "ConfirmedBackupRestore":
      return [
        { ...model, backupBusy: "restore" },
        [RestoreGroupBackup({ groupRef: message.groupRef })],
      ];
    case "RestoredBackup":
      return [
        {
          ...notified(model, {
            title: "Notes restored",
            body: `Restored ${message.notes} notes and ${message.images} images.`,
          }),
          restorePreview: null,
        },
        [],
      ];
    case "DismissedSettingsNotice":
      return [{ ...model, notice: null }, []];
    case "FailedSettingsAction":
      return [notified(model, { title: message.title, body: message.body, tone: "error" }), []];
    case "CompletedSettingsAction":
      return [model, []];
  }
};

/** The prefs the rest of the client reads: which the settings pages own, and
 *  which React's `useReaderPrefs`/`useNotesPrefs` hand out. */
export const settingsPrefs = (model: SettingsModel): UserPrefs => model.prefs;

/** The sentence React would have spawned a toast for. Page chrome belongs to
 *  the host, so it renders this and dismisses it with `DismissedSettingsNotice`. */
export const settingsNotice = (model: SettingsModel): SettingsNotice | null => model.notice;

export interface SettingsGroupRef {
  readonly groupId: string;
  readonly slug: string;
  readonly publicId: string;
}

export interface SettingsBook extends SettingsGroupRef {
  readonly profile: ClubProfile;
}

export interface SettingsViewContext<Message = never> {
  /** The club whose book is open. Without one the modal is account settings. */
  readonly book: SettingsBook | null;
  readonly signedIn: boolean;
  readonly onClose: Message;
  /**
   * React's account page is `AccountSettings`, which the Foldkit shell already
   * renders as a route of its own; the host passes that markup in rather than
   * this module keeping a second copy of the passkey and password forms.
   */
  readonly accountSection?: readonly Html[];
}

interface DropdownOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

// Account security is global and belongs on the homepage. Reader settings mix
// a club-specific profile with controls for the currently open book.
const categoriesFor = (
  book: SettingsBook | null,
  signedIn: boolean,
): readonly { id: SettingsCategory; label: string }[] => {
  if (book !== null) {
    return [
      { id: "user", label: "User" },
      { id: "general", label: "General" },
      { id: "pdf", label: "PDF" },
    ];
  }
  return signedIn ? [{ id: "account", label: "Account" }] : [];
};

export const settingsView = <Message>(
  model: SettingsModel,
  { book, signedIn, onClose, accountSection }: SettingsViewContext<Message>,
  h: HtmlBuilder<Message | SettingsMessage>,
): Html => {
  const categories = categoriesFor(book, signedIn);
  const category =
    model.category !== null && categories.some(({ id }) => id === model.category)
      ? model.category
      : (categories[0]?.id ?? "account");

  const settingDropdown = <T extends string>(
    dropdown: string,
    value: T,
    options: readonly DropdownOption<T>[],
    ariaLabel: string,
    toMessage: (value: T) => SettingsMessage,
  ): Html => {
    const open = model.openDropdown === dropdown;
    const active = options.find((option) => option.value === value);
    return h.div(
      [h.Class("book-menu settings-dropdown")],
      [
        h.button(
          [
            h.Type("button"),
            h.Class("settings-action settings-dropdown-trigger"),
            h.AriaHasPopup("menu"),
            h.AriaExpanded(open),
            h.AriaLabel(ariaLabel),
            h.Title(ariaLabel),
            h.OnClick(ToggledSettingsDropdown({ dropdown })),
          ],
          [
            h.span([], [active?.label ?? value]),
            h.span([h.Class("book-menu-arrow"), h.AriaHidden(true)], ["▾"]),
          ],
        ),
        ...(open
          ? [
              h.ul(
                [h.Class("book-menu-list"), h.Role("menu")],
                options.map((option) =>
                  h.li(
                    [h.Key(option.value), h.Role("none")],
                    [
                      h.button(
                        [
                          h.Type("button"),
                          h.Role("menuitemradio"),
                          h.AriaChecked(option.value === value),
                          h.Class(
                            option.value === value ? "book-menu-item is-active" : "book-menu-item",
                          ),
                          h.Title(option.label),
                          h.OnClick(toMessage(option.value)),
                        ],
                        [option.label],
                      ),
                    ],
                  ),
                ),
              ),
            ]
          : []),
      ],
    );
  };

  const settingRow = (head: string, desc: string, control: Html): Html =>
    h.section(
      [h.Class("settings-item")],
      [
        h.div(
          [h.Class("settings-item-text")],
          [
            h.h2([h.Class("settings-item-head")], [head]),
            h.p([h.Class("settings-item-desc")], [desc]),
          ],
        ),
        h.div([h.Class("settings-item-control")], [control]),
      ],
    );

  const settingCheckbox = (
    label: string,
    checked: boolean,
    toMessage: (value: boolean) => SettingsMessage,
  ): Html =>
    h.label(
      [h.Class("settings-item settings-item--checkbox")],
      [
        h.div([h.Class("settings-item-text")], [h.h2([h.Class("settings-item-head")], [label])]),
        h.input([
          h.Type("checkbox"),
          h.Class("settings-checkbox"),
          h.Checked(checked),
          h.OnClick(toMessage(!checked)),
        ]),
      ],
    );

  const userSection = (open: SettingsBook): readonly Html[] => {
    const profile = open.profile;
    const displayName = model.displayName ?? profile.displayName;
    const avatarUrl =
      profile.avatarImageId === undefined
        ? null
        : avatarImagePath(profile.id, profile.avatarImageId);
    const unchanged = displayName.trim() === profile.displayName;
    return [
      h.section(
        [h.Class("settings-item settings-user-profile")],
        [
          h.div(
            [h.Class("settings-user-avatar"), h.AriaLabel("Profile picture")],
            avatarUrl === null
              ? [h.span([], [avatarInitial(profile.displayName)])]
              : [h.img([h.Src(avatarUrl), h.Alt("")])],
          ),
          h.div(
            [h.Class("settings-item-text")],
            [
              h.h2([h.Class("settings-item-head")], ["Profile picture"]),
              h.p([h.Class("settings-item-desc")], []),
            ],
          ),
          h.div(
            [h.Class("settings-item-control")],
            [
              h.input([
                h.Id(AVATAR_INPUT_ID),
                h.Hidden(true),
                h.Type("file"),
                h.Accept("image/jpeg,image/png,image/webp,image/gif"),
                h.OnFileChange((files) =>
                  files[0] === undefined
                    ? CompletedSettingsAction()
                    : SelectedAvatarImage({ file: files[0] }),
                ),
              ]),
              h.button(
                [
                  h.Type("button"),
                  h.Class("settings-action"),
                  h.Disabled(model.uploadingAvatar || model.savingName),
                  h.OnClick(ChoseAvatarPhoto()),
                ],
                [model.uploadingAvatar ? "Uploading…" : "Choose photo"],
              ),
            ],
          ),
        ],
      ),
      h.section(
        [h.Class("settings-item settings-item--stacked")],
        [
          h.div(
            [h.Class("settings-item-text")],
            [
              h.h2([h.Class("settings-item-head")], ["Nickname"]),
              h.p([h.Class("settings-item-desc")], ["Per-club name"]),
            ],
          ),
          h.form(
            [
              h.Class("settings-text-submit-form"),
              h.OnSubmit(SubmittedDisplayName({ groupId: open.groupId, displayName })),
            ],
            [
              h.input([
                h.Value(displayName),
                h.Maxlength(MAX_DISPLAY_NAME_LENGTH),
                h.AriaLabel("Display name"),
                h.OnInput((value) => ChangedDisplayName({ value })),
              ]),
              h.button(
                [
                  h.Type("submit"),
                  h.Class("settings-action settings-text-submit-button"),
                  h.AriaLabel("Save display name"),
                  h.Title("Save display name (Enter)"),
                  h.Disabled(
                    model.savingName ||
                      model.uploadingAvatar ||
                      displayName.trim() === "" ||
                      unchanged,
                  ),
                ],
                [h.span([h.AriaHidden(true)], ["↵"])],
              ),
            ],
          ),
        ],
      ),
    ];
  };

  const generalSection = (): readonly Html[] => [
    settingRow(
      "Opening position",
      "Whether to sync reading position across browsers",
      settingDropdown(
        "readingPositionOpenPolicy",
        model.prefs.reader.readingPositionOpenPolicy,
        [
          { value: "prefer-sync", label: "Sync" },
          { value: "prefer-local", label: "Local" },
        ],
        "Opening reading position",
        (value) => ChoseOpeningPosition({ value }),
      ),
    ),
    settingCheckbox("Show profile pics", model.prefs.notes.showAvatars, (value) =>
      ToggledShowAvatars({ value }),
    ),
    settingCheckbox("Hashtags add tags", model.prefs.notes.hashtagsAddTags, (value) =>
      ToggledHashtagsAddTags({ value }),
    ),
    settingCheckbox("Show hashtags", model.prefs.notes.showHashtags, (value) =>
      ToggledShowHashtags({ value }),
    ),
  ];

  const pdfSection = (): readonly Html[] => [
    settingRow(
      "Page layout",
      "Show two pages side by side, book-style, when the screen is wide enough.",
      settingDropdown(
        "pdfPageLayout",
        model.prefs.reader.pdfPageLayout,
        [
          { value: "single", label: "Single page" },
          { value: "auto", label: "Two pages" },
        ],
        "PDF page layout",
        (value) => ChosePdfPageLayout({ value }),
      ),
    ),
    settingRow(
      "Smart arrow keys",
      "Arrow keys try to scroll before turning page.",
      settingDropdown(
        "smartArrows",
        model.prefs.reader.smartArrows,
        [
          { value: "off", label: "Off" },
          { value: "smooth", label: "Smooth" },
          { value: "instant", label: "Instant" },
        ],
        "PDF smart arrow keys",
        (value) => ChoseSmartArrows({ value }),
      ),
    ),
  ];

  const body = (): readonly Html[] => {
    if (category === "account") return accountSection ?? [];
    if (category === "user") return book === null ? [] : userSection(book);
    if (category === "general") return book === null ? [] : generalSection();
    return pdfSection();
  };

  return modalView<Message | SettingsMessage>(
    { title: book === null ? "account settings" : "settings", onClose },
    h,
    [
      h.div([h.Class("modal-body settings-body")], body()),
      ...(categories.length > 1
        ? [
            modalTabsView<SettingsCategory, Message | SettingsMessage>(
              categories.map(({ id, label }) => ({ id, label, title: `${label} settings` })),
              category,
              (id) => ChoseSettingsCategory({ category: id }),
              h,
              "settings-tabs",
            ),
          ]
        : []),
    ],
  );
};

/**
 * React's `BackupControls`, which lives in the club's presence modal rather than
 * in the settings modal; it is here because the state it needs is settings
 * state. The host places it wherever its own chrome puts it.
 */
export const backupControlsView = <Message>(
  model: SettingsModel,
  group: SettingsGroupRef,
  h: HtmlBuilder<Message | SettingsMessage>,
): Html => {
  const groupRef = groupUrlName(group);
  const armed = model.backupBusy !== null || model.armedDownload !== null;

  const actionRow = (children: readonly Html[]): Html =>
    h.div([h.Class("settings-backup-actions")], children);

  return h.div(
    [h.Class("group-backup-controls")],
    [
      actionRow([
        h.button(
          [
            h.Type("button"),
            h.Class("settings-action"),
            h.Disabled(armed),
            h.OnClick(RequestedBackupDownload({ groupRef })),
          ],
          [model.backupBusy === "download" ? "creating…" : "Backup notes"],
        ),
        h.input([
          h.Id(BACKUP_INPUT_ID),
          h.Hidden(true),
          h.Type("file"),
          h.Accept(`${BOOKCLUB_ARCHIVE_EXTENSION},${BOOKCLUB_ARCHIVE_CONTENT_TYPE}`),
          h.OnFileChange((files) =>
            files[0] === undefined
              ? CompletedSettingsAction()
              : SelectedBackupFile({ groupId: group.groupId, file: files[0] }),
          ),
        ]),
        h.button(
          [
            h.Type("button"),
            h.Class("settings-action"),
            h.Disabled(armed),
            h.OnClick(ChoseRestoreFile()),
          ],
          ["Restore notes"],
        ),
      ]),
      ...(model.armedDownload === null
        ? []
        : [
            h.dialog(
              [
                h.Class("backup-download-confirm"),
                h.Open(true),
                h.AriaLabel("Confirm notes backup"),
              ],
              [
                h.p(
                  [],
                  [
                    `This will download note data into a zip file of ${formatBytes(
                      model.armedDownload.size,
                    )}.`,
                  ],
                ),
                actionRow([
                  h.button(
                    [
                      h.Type("button"),
                      h.Class("settings-action"),
                      h.Disabled(model.backupBusy !== null),
                      h.OnClick(CancelledBackupDownload()),
                    ],
                    ["Cancel"],
                  ),
                  h.button(
                    [
                      h.Type("button"),
                      h.Class("settings-action settings-backup-restore"),
                      h.Disabled(model.backupBusy !== null),
                      h.OnClick(ConfirmedBackupDownload()),
                    ],
                    [model.backupBusy === "download" ? "downloading…" : "Download"],
                  ),
                ]),
              ],
            ),
          ]),
      ...(model.restorePreview === null
        ? []
        : [
            h.div(
              [h.Class("settings-backup-preview"), h.Role("status")],
              [
                h.strong([], ["Replace all current notes?"]),
                h.span(
                  [],
                  [
                    `${model.restorePreview.clubName} · ${model.restorePreview.notes} notes · ${model.restorePreview.images} images · ${new Date(
                      model.restorePreview.createdAt,
                    ).toLocaleString()}`,
                  ],
                ),
                h.p(
                  [],
                  [
                    "The restore process will replace ALL current notes and cannot be undone. Download a current backup first if needed.",
                  ],
                ),
                actionRow([
                  h.button(
                    [
                      h.Type("button"),
                      h.Class("settings-action"),
                      h.Disabled(model.backupBusy !== null),
                      h.OnClick(CancelledBackupRestore()),
                    ],
                    ["Cancel"],
                  ),
                  h.button(
                    [
                      h.Type("button"),
                      h.Class("settings-action settings-backup-restore"),
                      h.Disabled(model.backupBusy !== null),
                      h.OnClick(ConfirmedBackupRestore({ groupRef })),
                    ],
                    [model.backupBusy === "restore" ? "restoring…" : "Restore exactly"],
                  ),
                ]),
              ],
            ),
          ]),
    ],
  );
};
