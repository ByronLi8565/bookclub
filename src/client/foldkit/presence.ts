import toolIcon from "@assets/tool.svg";
import trashIcon from "@assets/trash.svg";
import { Effect, Schema, Stream } from "effect";
import { Command } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { m } from "foldkit/message";
import { formatBytes } from "../../shared/format.ts";
import { GroupAction, permits } from "../../shared/groupPermissions.ts";
import {
  GroupRole,
  GroupRoleSchema,
  GroupSummary,
  RosterEntry,
  type SourceMeta,
} from "../../shared/types/groups.ts";
import { contentTypeFor, extensionFor, type SourceKind } from "../../shared/types/sources.ts";
import { avatarImagePath, avatarInitial } from "../logic/groups/groupClient.ts";
import { getCachedSource, putCachedSource } from "../logic/groups/sourceCache.ts";
import { downloadFile } from "../logic/files/browserDownload.ts";
import { bookclubClient } from "../logic/net/bookclubClient.ts";
import { isNative } from "../logic/net/api.ts";
import { modalTabsView, modalView } from "./modal.ts";
import { ChangedNoteAgentPresence } from "./resources/noteAgent.ts";

const OnlinePeers = ChangedNoteAgentPresence.fields.peers;
/** The peer shape the note-agent socket publishes; presence never opens its own. */
export type OnlinePeer = (typeof OnlinePeers.Type)[number];

const GroupImage = Schema.Struct({
  id: Schema.String,
  size: Schema.Number,
  contentType: Schema.String,
  uploadedAt: Schema.String,
  uploadedBy: Schema.NullOr(Schema.String),
  uploaderName: Schema.String,
});
export type GroupImage = typeof GroupImage.Type;

const PendingBookDelete = Schema.Struct({ sourceId: Schema.String, title: Schema.String });

const PresencePage = Schema.Literals(["people", "books", "images"]);
export type PresencePage = typeof PresencePage.Type;

/**
 * Everything React's `PresenceModal` kept in component state, plus the club the
 * open modal belongs to: `update` has no view context, so the reference every
 * server call needs has to travel in the Model rather than in the view.
 */
export const PresenceModel = Schema.Struct({
  groupRef: Schema.String,
  page: PresencePage,
  openRoleMenuId: Schema.NullOr(Schema.String),
  pendingRoleMemberId: Schema.NullOr(Schema.String),
  pendingRole: Schema.NullOr(GroupRoleSchema),
  savingRole: Schema.Boolean,
  /** React's `deleting`: the book or image whose deletion is in flight. */
  deletingId: Schema.NullOr(Schema.String),
  /** The book whose inline `.delete-confirm` popover is open. */
  confirmingDeleteSourceId: Schema.NullOr(Schema.String),
  pendingBookDelete: Schema.NullOr(PendingBookDelete),
  bookDeleteTitleDraft: Schema.String,
  editingMetadataSourceId: Schema.NullOr(Schema.String),
  authorDraft: Schema.String,
  savingAuthor: Schema.Boolean,
  downloadingBook: Schema.Boolean,
  images: Schema.NullOr(Schema.Array(GroupImage)),
  imageTotalSize: Schema.Number,
  imageError: Schema.NullOr(Schema.String),
  visibleImages: Schema.Array(Schema.String),
});
export type PresenceModel = typeof PresenceModel.Type;

export const initialPresenceModel = (): PresenceModel => ({
  groupRef: "",
  page: "people",
  openRoleMenuId: null,
  pendingRoleMemberId: null,
  pendingRole: null,
  savingRole: false,
  deletingId: null,
  confirmingDeleteSourceId: null,
  pendingBookDelete: null,
  bookDeleteTitleDraft: "",
  editingMetadataSourceId: null,
  authorDraft: "",
  savingAuthor: false,
  downloadingBook: false,
  images: null,
  imageTotalSize: 0,
  imageError: null,
  visibleImages: [],
});

export const OpenedPresence = m("OpenedPresence", { groupRef: Schema.String });
export const ChangedPresencePage = m("ChangedPresencePage", { page: PresencePage });

export const ToggledRoleMenu = m("ToggledRoleMenu", { memberId: Schema.String });
export const ClosedRoleMenu = m("ClosedRoleMenu");
export const ChoseMemberRole = m("ChoseMemberRole", {
  memberId: Schema.String,
  role: GroupRoleSchema,
});
export const CancelledRoleChange = m("CancelledRoleChange");
export const ConfirmedRoleChange = m("ConfirmedRoleChange");
export const ChangedMemberRole = m("ChangedMemberRole", { members: Schema.Array(RosterEntry) });
export const FailedRoleChange = m("FailedRoleChange");

export const ToggledBookTools = m("ToggledBookTools", {
  sourceId: Schema.String,
  author: Schema.NullOr(Schema.String),
});
export const ClosedBookTools = m("ClosedBookTools");
export const ChangedBookAuthor = m("ChangedBookAuthor", { author: Schema.String });
export const SubmittedBookAuthor = m("SubmittedBookAuthor");
export const SavedBookMetadata = m("SavedBookMetadata", { group: GroupSummary });
export const FailedBookMetadata = m("FailedBookMetadata");
export const RequestedBookDownload = m("RequestedBookDownload", { sourceId: Schema.String });
export const CompletedBookDownload = m("CompletedBookDownload");
export const FailedBookDownload = m("FailedBookDownload");

export const StartedBookDeleteConfirm = m("StartedBookDeleteConfirm", { sourceId: Schema.String });
export const CancelledBookDeleteConfirm = m("CancelledBookDeleteConfirm");
export const ConfirmedBookDeleteConfirm = m("ConfirmedBookDeleteConfirm", {
  sourceId: Schema.String,
  title: Schema.String,
});
export const ChangedBookDeleteTitle = m("ChangedBookDeleteTitle", { title: Schema.String });
export const CancelledBookDelete = m("CancelledBookDelete");
export const SubmittedBookDelete = m("SubmittedBookDelete");
export const DeletedBook = m("DeletedBook", { group: GroupSummary });
export const FailedBookDelete = m("FailedBookDelete");

export const LoadedGroupImages = m("LoadedGroupImages", {
  images: Schema.Array(GroupImage),
  totalSize: Schema.Number,
});
export const FailedGroupImages = m("FailedGroupImages");
export const ToggledImagePreview = m("ToggledImagePreview", { imageId: Schema.String });
export const RequestedImageDelete = m("RequestedImageDelete", {
  imageId: Schema.String,
  size: Schema.Number,
  index: Schema.Number,
});
export const ConfirmedImageDelete = m("ConfirmedImageDelete", {
  imageId: Schema.String,
  size: Schema.Number,
});
export const DeclinedImageDelete = m("DeclinedImageDelete");
export const DeletedGroupImage = m("DeletedGroupImage", {
  imageId: Schema.String,
  size: Schema.Number,
});
export const FailedGroupImageDelete = m("FailedGroupImageDelete");

export const PresenceMessage = Schema.Union([
  OpenedPresence,
  ChangedPresencePage,
  ToggledRoleMenu,
  ClosedRoleMenu,
  ChoseMemberRole,
  CancelledRoleChange,
  ConfirmedRoleChange,
  ChangedMemberRole,
  FailedRoleChange,
  ToggledBookTools,
  ClosedBookTools,
  ChangedBookAuthor,
  SubmittedBookAuthor,
  SavedBookMetadata,
  FailedBookMetadata,
  RequestedBookDownload,
  CompletedBookDownload,
  FailedBookDownload,
  StartedBookDeleteConfirm,
  CancelledBookDeleteConfirm,
  ConfirmedBookDeleteConfirm,
  ChangedBookDeleteTitle,
  CancelledBookDelete,
  SubmittedBookDelete,
  DeletedBook,
  FailedBookDelete,
  LoadedGroupImages,
  FailedGroupImages,
  ToggledImagePreview,
  RequestedImageDelete,
  ConfirmedImageDelete,
  DeclinedImageDelete,
  DeletedGroupImage,
  FailedGroupImageDelete,
]);
export type PresenceMessage = typeof PresenceMessage.Type;

export const isPresenceMessage = Schema.is(PresenceMessage);

export const SetMemberRole = Command.define("SetMemberRole", {
  args: { groupRef: Schema.String, memberId: Schema.String, role: GroupRoleSchema },
  messages: [ChangedMemberRole, FailedRoleChange],
  execute: ({ groupRef, memberId, role }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) =>
        client.groups.setMemberRole({ params: { groupRef, memberId }, payload: { role } }),
      ),
      Effect.map(({ members }) => ChangedMemberRole({ members })),
      Effect.catch(() => Effect.succeed(FailedRoleChange())),
    ),
});

export const LoadGroupImages = Command.define("LoadGroupImages", {
  args: { groupRef: Schema.String },
  messages: [LoadedGroupImages, FailedGroupImages],
  execute: ({ groupRef }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.groups.images({ params: { groupRef } })),
      Effect.map(({ images, totalSize }) => LoadedGroupImages({ images, totalSize })),
      Effect.catch(() => Effect.succeed(FailedGroupImages())),
    ),
});

/** React asks through `window.confirm` before it deletes an upload; the prompt
 *  is a side effect, so it runs as a Command rather than inside `update`. */
export const AskToDeleteImage = Command.define("AskToDeleteImage", {
  args: { imageId: Schema.String, size: Schema.Number, index: Schema.Number },
  messages: [ConfirmedImageDelete, DeclinedImageDelete],
  execute: ({ imageId, size, index }) =>
    Effect.sync(() =>
      globalThis.confirm(`Delete image ${index + 1} from this club and all notes?`)
        ? ConfirmedImageDelete({ imageId, size })
        : DeclinedImageDelete(),
    ),
});

export const DeleteGroupImage = Command.define("DeleteGroupImage", {
  args: { groupRef: Schema.String, imageId: Schema.String, size: Schema.Number },
  messages: [DeletedGroupImage, FailedGroupImageDelete],
  execute: ({ groupRef, imageId, size }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.groups.deleteImage({ params: { groupRef, imageId } })),
      Effect.as(DeletedGroupImage({ imageId, size })),
      Effect.catch(() => Effect.succeed(FailedGroupImageDelete())),
    ),
});

export const DeleteGroupBook = Command.define("DeleteGroupBook", {
  args: { groupRef: Schema.String, sourceId: Schema.String },
  messages: [DeletedBook, FailedBookDelete],
  execute: ({ groupRef, sourceId }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.groups.deleteBook({ params: { groupRef, sourceId } })),
      Effect.map(({ group }) => DeletedBook({ group })),
      Effect.catch(() => Effect.succeed(FailedBookDelete())),
    ),
});

export const UpdateBookMetadata = Command.define("UpdateBookMetadata", {
  args: { groupRef: Schema.String, sourceId: Schema.String, author: Schema.NullOr(Schema.String) },
  messages: [SavedBookMetadata, FailedBookMetadata],
  execute: ({ groupRef, sourceId, author }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) =>
        client.groups.updateBookMetadata({ params: { groupRef, sourceId }, payload: { author } }),
      ),
      Effect.map(({ group }) => SavedBookMetadata({ group })),
      Effect.catch(() => Effect.succeed(FailedBookMetadata())),
    ),
});

const PDF_MAGIC = "%PDF";

const sniffSourceKind = (head: ArrayBuffer): SourceKind =>
  new TextDecoder().decode(head) === PDF_MAGIC ? "pdf" : "epub";

const fetchBookFile = (groupRef: string, sourceId: string): Effect.Effect<File> =>
  Effect.promise(async () => {
    const cached = await getCachedSource(sourceId);
    if (cached !== null) return cached;
    const bytes = await Effect.runPromise(
      bookclubClient.pipe(
        Effect.flatMap((client) =>
          client.groups.book({ params: { groupRef }, query: { sourceId } }),
        ),
        Effect.flatMap((stream) => Stream.runCollect(stream)),
      ),
    );
    // SAFETY: the response stream yields Uint8Array chunks backed by ArrayBuffer, not SharedArrayBuffer.
    const blob = new Blob([...bytes] as BlobPart[]);
    const kind = sniffSourceKind(await blob.slice(0, 4).arrayBuffer());
    const file = new File([blob], `${sourceId}.${extensionFor(kind)}`, {
      type: contentTypeFor(kind),
    });
    await putCachedSource(sourceId, file);
    return file;
  });

/** On the web the copy lands in the browser's downloads; natively the cache the
 *  reader opens from *is* the offline copy, so filling it is the whole job. */
export const DownloadBookCopy = Command.define("DownloadBookCopy", {
  args: { groupRef: Schema.String, sourceId: Schema.String },
  messages: [CompletedBookDownload, FailedBookDownload],
  execute: ({ groupRef, sourceId }) =>
    fetchBookFile(groupRef, sourceId).pipe(
      Effect.map((file) => {
        if (!isNative) downloadFile(file);
        return CompletedBookDownload();
      }),
      Effect.catch(() => Effect.succeed(FailedBookDownload())),
    ),
});

export type PresenceCommand =
  | ReturnType<typeof SetMemberRole>
  | ReturnType<typeof LoadGroupImages>
  | ReturnType<typeof AskToDeleteImage>
  | ReturnType<typeof DeleteGroupImage>
  | ReturnType<typeof DeleteGroupBook>
  | ReturnType<typeof UpdateBookMetadata>
  | ReturnType<typeof DownloadBookCopy>;

const withoutImage = (
  images: readonly GroupImage[] | null,
  imageId: string,
): readonly GroupImage[] | null =>
  images === null ? null : images.filter((candidate) => candidate.id !== imageId);

export const updatePresence = (
  model: PresenceModel,
  message: PresenceMessage,
): readonly [PresenceModel, readonly PresenceCommand[]] => {
  switch (message._tag) {
    case "OpenedPresence":
      // React remounts the modal on a club change, so nothing a reader was part
      // way through on the last club survives into this one.
      return [{ ...initialPresenceModel(), groupRef: message.groupRef }, []];
    case "ChangedPresencePage":
      return [
        { ...model, page: message.page },
        // The images page loads once and keeps what it found.
        message.page === "images" && model.images === null
          ? [LoadGroupImages({ groupRef: model.groupRef })]
          : [],
      ];
    case "ToggledRoleMenu":
      return [
        {
          ...model,
          openRoleMenuId: model.openRoleMenuId === message.memberId ? null : message.memberId,
        },
        [],
      ];
    case "ClosedRoleMenu":
      return [{ ...model, openRoleMenuId: null }, []];
    case "ChoseMemberRole":
      return [
        {
          ...model,
          openRoleMenuId: null,
          pendingRoleMemberId: message.memberId,
          pendingRole: message.role,
        },
        [],
      ];
    case "CancelledRoleChange":
      return [{ ...model, pendingRoleMemberId: null, pendingRole: null }, []];
    case "ConfirmedRoleChange":
      return model.pendingRoleMemberId === null || model.pendingRole === null
        ? [model, []]
        : [
            { ...model, savingRole: true },
            [
              SetMemberRole({
                groupRef: model.groupRef,
                memberId: model.pendingRoleMemberId,
                role: model.pendingRole,
              }),
            ],
          ];
    case "ChangedMemberRole":
      return [{ ...model, savingRole: false, pendingRoleMemberId: null, pendingRole: null }, []];
    case "FailedRoleChange":
      return [{ ...model, savingRole: false }, []];
    case "ToggledBookTools":
      return [
        model.editingMetadataSourceId === message.sourceId
          ? { ...model, editingMetadataSourceId: null }
          : {
              ...model,
              editingMetadataSourceId: message.sourceId,
              authorDraft: message.author ?? "",
              savingAuthor: false,
              downloadingBook: false,
            },
        [],
      ];
    case "ClosedBookTools":
      return [{ ...model, editingMetadataSourceId: null }, []];
    case "ChangedBookAuthor":
      return [{ ...model, authorDraft: message.author }, []];
    case "SubmittedBookAuthor":
      return model.editingMetadataSourceId === null
        ? [model, []]
        : [
            { ...model, savingAuthor: true },
            [
              UpdateBookMetadata({
                groupRef: model.groupRef,
                sourceId: model.editingMetadataSourceId,
                author: model.authorDraft.trim() || null,
              }),
            ],
          ];
    case "SavedBookMetadata":
      return [{ ...model, savingAuthor: false, editingMetadataSourceId: null }, []];
    case "FailedBookMetadata":
      return [{ ...model, savingAuthor: false }, []];
    case "RequestedBookDownload":
      return [
        { ...model, downloadingBook: true },
        [DownloadBookCopy({ groupRef: model.groupRef, sourceId: message.sourceId })],
      ];
    case "CompletedBookDownload":
    case "FailedBookDownload":
      return [{ ...model, downloadingBook: false }, []];
    case "StartedBookDeleteConfirm":
      return [{ ...model, confirmingDeleteSourceId: message.sourceId }, []];
    case "CancelledBookDeleteConfirm":
      return [{ ...model, confirmingDeleteSourceId: null }, []];
    case "ConfirmedBookDeleteConfirm":
      return [
        {
          ...model,
          confirmingDeleteSourceId: null,
          pendingBookDelete: { sourceId: message.sourceId, title: message.title },
          bookDeleteTitleDraft: "",
        },
        [],
      ];
    case "ChangedBookDeleteTitle":
      return [{ ...model, bookDeleteTitleDraft: message.title }, []];
    case "CancelledBookDelete":
      // A delete already in flight owns the modal until it settles.
      return model.deletingId === null
        ? [{ ...model, pendingBookDelete: null, bookDeleteTitleDraft: "" }, []]
        : [model, []];
    case "SubmittedBookDelete":
      return model.pendingBookDelete === null ||
        model.bookDeleteTitleDraft !== model.pendingBookDelete.title ||
        model.deletingId !== null
        ? [model, []]
        : [
            { ...model, deletingId: model.pendingBookDelete.sourceId },
            [
              DeleteGroupBook({
                groupRef: model.groupRef,
                sourceId: model.pendingBookDelete.sourceId,
              }),
            ],
          ];
    case "DeletedBook":
      return [
        { ...model, deletingId: null, pendingBookDelete: null, bookDeleteTitleDraft: "" },
        [],
      ];
    case "FailedBookDelete":
      return [{ ...model, deletingId: null }, []];
    case "LoadedGroupImages":
      return [{ ...model, images: message.images, imageTotalSize: message.totalSize }, []];
    case "FailedGroupImages":
      return [{ ...model, imageError: "Could not load images." }, []];
    case "ToggledImagePreview":
      return [
        {
          ...model,
          visibleImages: model.visibleImages.includes(message.imageId)
            ? model.visibleImages.filter((id) => id !== message.imageId)
            : [...model.visibleImages, message.imageId],
        },
        [],
      ];
    case "RequestedImageDelete":
      return [
        model,
        [AskToDeleteImage({ imageId: message.imageId, size: message.size, index: message.index })],
      ];
    case "ConfirmedImageDelete":
      return [
        { ...model, deletingId: message.imageId },
        [
          DeleteGroupImage({
            groupRef: model.groupRef,
            imageId: message.imageId,
            size: message.size,
          }),
        ],
      ];
    case "DeclinedImageDelete":
      return [model, []];
    case "DeletedGroupImage":
      return [
        {
          ...model,
          deletingId: null,
          images: withoutImage(model.images, message.imageId),
          imageTotalSize: Math.max(0, model.imageTotalSize - message.size),
          visibleImages: model.visibleImages.filter((id) => id !== message.imageId),
          imageError: null,
        },
        [],
      ];
    case "FailedGroupImageDelete":
      return [{ ...model, deletingId: null, imageError: "Could not delete image." }, []];
  }
};

export interface PresencePerson {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: GroupRole;
  readonly isOnline: boolean;
  readonly avatarImageId?: string;
}

/** React's `mergePeople`: the roster is who belongs, the socket is who is here,
 *  and whoever is here sorts first. */
export const presencePeople = (
  members: readonly RosterEntry[],
  online: readonly OnlinePeer[],
): readonly PresencePerson[] => {
  const onlineIds = new Set(online.map((person) => person.id));
  const byId = new Map<string, PresencePerson>();
  for (const member of members) {
    byId.set(member.id, { ...member, isOnline: onlineIds.has(member.id) });
  }
  for (const person of online) {
    const member = byId.get(person.id);
    byId.set(person.id, { ...member, ...person, email: member?.email ?? "", isOnline: true });
  }
  return [...byId.values()].toSorted((a, b) => Number(b.isOnline) - Number(a.isOnline));
};

const ASSIGNABLE_ROLES = [GroupRole.Visitor, GroupRole.Member, GroupRole.Admin] as const;

export const assignableRoles = (viewerRole: GroupRole, currentRole: GroupRole): GroupRole[] => {
  if (currentRole === GroupRole.Owner) return [];
  if (viewerRole === GroupRole.Owner) return [...ASSIGNABLE_ROLES];
  if (viewerRole === GroupRole.Admin && currentRole !== GroupRole.Admin) {
    return [GroupRole.Visitor, GroupRole.Member];
  }
  return [];
};

/** What `presencePeopleView` needs to draw the roster on its own, which is all
 *  the invite slice needs to nest it between its form and its share row. */
export interface PresenceRosterContext {
  readonly members: readonly RosterEntry[];
  /** The note-agent socket's peer list, handed over rather than re-derived:
   *  presence rides that connection and never opens a second one. */
  readonly peers: readonly OnlinePeer[];
  readonly viewerRole: GroupRole;
}

export interface PresenceViewContext<Message> extends PresenceRosterContext {
  readonly group: GroupSummary;
  readonly viewerId: string;
  readonly onClose: Message;
  /**
   * React has one `InviteControls`, shared with the invite modal, so the invite
   * slice owns it: pass `inviteControlsView(inviteModel, { group, children:
   * [presencePeopleView(...)] }, h)`. The roster belongs inside it, exactly
   * where React puts its children.
   */
  readonly inviteControls: readonly Html[];
  /** React has one `BackupControls`, shared with the settings page, so the
   *  settings slice owns it: pass `[backupControlsView(settingsModel, group, h)]`. */
  readonly backupControls: readonly Html[];
}

const confirmRowView = <Message>(
  h: HtmlBuilder<Message>,
  options: {
    readonly className: string;
    readonly ariaLabel: string;
    readonly prompt: readonly (string | Html)[];
    readonly cancel: {
      readonly ariaLabel: string;
      readonly title: string;
      readonly message: Message;
    };
    readonly confirm: {
      readonly ariaLabel: string;
      readonly title: string;
      readonly message: Message;
      readonly disabled: boolean;
    };
  },
): Html =>
  h.dialog(
    [h.Open(true), h.Class(options.className), h.AriaLabel(options.ariaLabel)],
    [
      h.p([], options.prompt),
      h.div(
        [h.Class("delete-confirm-actions")],
        [
          h.button(
            [
              h.Type("button"),
              h.OnClick(options.cancel.message),
              h.AriaLabel(options.cancel.ariaLabel),
              h.Title(options.cancel.title),
            ],
            ["✕"],
          ),
          h.span([], ["|"]),
          h.button(
            [
              h.Type("button"),
              h.OnClick(options.confirm.message),
              h.AriaLabel(options.confirm.ariaLabel),
              h.Title(options.confirm.title),
              h.Disabled(options.confirm.disabled),
            ],
            ["✓"],
          ),
        ],
      ),
    ],
  );

const roleControlView = <Message>(
  model: PresenceModel,
  person: PresencePerson,
  viewerRole: GroupRole,
  h: HtmlBuilder<Message | PresenceMessage>,
): Html => {
  const roles = assignableRoles(viewerRole, person.role);
  if (roles.length === 0) return h.span([h.Class("invite-person-role label")], [person.role]);

  const open = model.openRoleMenuId === person.id;
  const pending = model.pendingRoleMemberId === person.id ? model.pendingRole : null;
  const triggerLabel = `Change role for ${person.name}`;

  return h.div(
    [h.Class("invite-person-role-control")],
    [
      h.div(
        [h.Class("book-menu settings-dropdown invite-person-role-dropdown")],
        [
          h.button(
            [
              h.Type("button"),
              h.Class("settings-action settings-dropdown-trigger invite-person-role label"),
              h.AriaHasPopup("menu"),
              h.AriaExpanded(open),
              h.AriaLabel(triggerLabel),
              h.Title(triggerLabel),
              h.Disabled(model.savingRole),
              h.OnClick(ToggledRoleMenu({ memberId: person.id })),
            ],
            [
              h.span([], [person.role]),
              h.span([h.Class("book-menu-arrow"), h.AriaHidden(true)], ["▾"]),
            ],
          ),
          ...(open
            ? [
                h.ul(
                  [h.Class("book-menu-list"), h.Role("menu")],
                  roles.map((role) =>
                    h.li(
                      [h.Key(role), h.Role("none")],
                      [
                        h.button(
                          [
                            h.Type("button"),
                            h.Role("menuitemradio"),
                            h.AriaChecked(role === person.role),
                            h.Class(
                              role === person.role ? "book-menu-item is-active" : "book-menu-item",
                            ),
                            h.Title(`Change role to ${role}`),
                            h.OnClick(ChoseMemberRole({ memberId: person.id, role })),
                          ],
                          [role],
                        ),
                      ],
                    ),
                  ),
                ),
              ]
            : []),
        ],
      ),
      ...(pending === null || pending === person.role
        ? []
        : [
            confirmRowView(h, {
              className: "delete-confirm role-change-confirm",
              ariaLabel: "Confirm role change",
              prompt: [`Really change this user to ${pending.toUpperCase()}?`],
              cancel: {
                ariaLabel: "cancel role change",
                title: "Keep current role",
                message: CancelledRoleChange(),
              },
              confirm: {
                ariaLabel: "confirm role change",
                title: `Change role to ${pending}`,
                message: ConfirmedRoleChange(),
                disabled: model.savingRole,
              },
            }),
          ]),
    ],
  );
};

export const presencePeopleView = <Message>(
  model: PresenceModel,
  context: PresenceRosterContext,
  h: HtmlBuilder<Message | PresenceMessage>,
): Html => {
  const people = presencePeople(context.members, context.peers);
  const onlineCount = people.filter((person) => person.isOnline).length;

  return h.div(
    [h.Class("invite-people")],
    [
      h.p([h.Class("invite-people-head label")], [`${onlineCount} of ${people.length} online`]),
      h.ul(
        [h.Class("invite-people-list")],
        people.map((person) =>
          h.li(
            [h.Key(person.id), h.Class(person.isOnline ? "" : "person--offline")],
            [
              h.span(
                [h.Class("invite-avatar")],
                [
                  person.avatarImageId === undefined
                    ? avatarInitial(person.name)
                    : h.img([h.Src(avatarImagePath(person.id, person.avatarImageId)), h.Alt("")]),
                  h.span(
                    [h.Class(`presence-pip presence-pip--${person.isOnline ? "on" : "off"}`)],
                    [],
                  ),
                ],
              ),
              h.span(
                [h.Class("invite-person-text")],
                [
                  h.span([h.Class("invite-person-name truncate")], [person.name]),
                  ...(person.email === ""
                    ? []
                    : [h.span([h.Class("invite-person-email truncate")], [person.email])]),
                ],
              ),
              roleControlView(model, person, context.viewerRole, h),
            ],
          ),
        ),
      ),
    ],
  );
};

const bookMetadataView = <Message>(
  model: PresenceModel,
  sourceId: string,
  canEdit: boolean,
  h: HtmlBuilder<Message | PresenceMessage>,
): Html =>
  h.div(
    [h.Class("group-book-metadata")],
    [
      ...(canEdit
        ? [
            h.label([h.For(`book-author-${sourceId}`)], ["Author"]),
            h.form(
              [h.Class("settings-text-submit-form"), h.OnSubmit(SubmittedBookAuthor())],
              [
                h.input([
                  h.Id(`book-author-${sourceId}`),
                  h.Value(model.authorDraft),
                  h.Placeholder("Author name"),
                  h.OnInput((author) => ChangedBookAuthor({ author })),
                ]),
                h.button(
                  [
                    h.Type("submit"),
                    h.Class("settings-action settings-text-submit-button"),
                    h.Disabled(model.savingAuthor),
                    h.AriaLabel("Save author"),
                    h.Title("Save author (Enter)"),
                  ],
                  [h.span([h.AriaHidden(true)], ["↵"])],
                ),
              ],
            ),
          ]
        : []),
      h.button(
        [
          h.Type("button"),
          h.Class("settings-action group-book-download"),
          h.Disabled(model.downloadingBook),
          h.OnClick(RequestedBookDownload({ sourceId })),
        ],
        [
          model.downloadingBook
            ? "downloading…"
            : isNative
              ? "Save offline"
              : "Download local copy",
        ],
      ),
    ],
  );

const bookRowView = <Message>(
  model: PresenceModel,
  context: PresenceViewContext<Message>,
  sourceId: string,
  h: HtmlBuilder<Message | PresenceMessage>,
): Html => {
  const meta: SourceMeta | undefined = context.group.sourceMeta[sourceId];
  const title = context.group.bookTitles[sourceId] ?? meta?.title ?? "Untitled book";
  const wordCount = meta?.wordCount;
  const ownBook = meta?.addedBy === context.viewerId;
  const canDelete =
    meta === undefined
      ? false
      : permits(
          context.viewerRole,
          ownBook ? GroupAction.DeleteOwnBook : GroupAction.DeleteAnyBook,
        );
  const canEditMetadata =
    meta === undefined
      ? false
      : permits(
          context.viewerRole,
          ownBook ? GroupAction.EditOwnBookMetadata : GroupAction.EditAnyBookMetadata,
        );
  const canUseBookTools = permits(context.viewerRole, GroupAction.ReadBook);
  const metadataOpen = model.editingMetadataSourceId === sourceId;
  const confirming = model.confirmingDeleteSourceId === sourceId;

  return h.li(
    [h.Key(sourceId)],
    [
      h.div(
        [h.Class("group-book-row")],
        [
          h.div(
            [h.Class("group-book-info")],
            [
              h.strong([h.Class("group-book-name")], [title]),
              ...(meta?.author === undefined || meta.author === null || meta.author === ""
                ? []
                : [h.span([h.Class("group-book-author")], [meta.author])]),
              h.span(
                [h.Class("group-book-stats")],
                [
                  wordCount === null || wordCount === undefined
                    ? ""
                    : `${wordCount.toLocaleString()} words · `,
                  formatBytes(meta?.size ?? 0),
                ],
              ),
            ],
          ),
          ...(canUseBookTools || canDelete
            ? [
                h.div(
                  [h.Class("group-book-actions")],
                  [
                    ...(canUseBookTools
                      ? [
                          h.button(
                            [
                              h.Type("button"),
                              h.Class("group-book-icon"),
                              h.OnClick(
                                metadataOpen
                                  ? ClosedBookTools()
                                  : ToggledBookTools({ sourceId, author: meta?.author ?? null }),
                              ),
                              h.AriaExpanded(metadataOpen),
                              h.AriaLabel(canEditMetadata ? "Edit book metadata" : "Book tools"),
                              h.Title("Book tools"),
                            ],
                            [h.img([h.Src(toolIcon), h.Alt(""), h.AriaHidden(true)])],
                          ),
                        ]
                      : []),
                    ...(canDelete
                      ? [
                          h.div(
                            [h.Class("group-book-delete")],
                            [
                              h.button(
                                [
                                  h.Type("button"),
                                  h.Class("group-book-icon"),
                                  h.Disabled(model.deletingId !== null),
                                  h.OnClick(StartedBookDeleteConfirm({ sourceId })),
                                  h.AriaLabel(`Delete ${title}`),
                                  h.AriaExpanded(confirming),
                                  h.Title("Delete book"),
                                ],
                                [h.img([h.Src(trashIcon), h.Alt(""), h.AriaHidden(true)])],
                              ),
                              ...(confirming
                                ? [
                                    confirmRowView(h, {
                                      className: "delete-confirm",
                                      ariaLabel: "Confirm delete",
                                      prompt: [
                                        "This will delete the book for EVERYONE. Really delete?",
                                      ],
                                      cancel: {
                                        ariaLabel: "cancel delete",
                                        title: "Keep book",
                                        message: CancelledBookDeleteConfirm(),
                                      },
                                      confirm: {
                                        ariaLabel: "confirm delete",
                                        title: "Delete book",
                                        message: ConfirmedBookDeleteConfirm({ sourceId, title }),
                                        disabled: model.deletingId !== null,
                                      },
                                    }),
                                  ]
                                : []),
                            ],
                          ),
                        ]
                      : []),
                  ],
                ),
              ]
            : []),
        ],
      ),
      ...(metadataOpen ? [bookMetadataView(model, sourceId, canEditMetadata, h)] : []),
    ],
  );
};

const booksView = <Message>(
  model: PresenceModel,
  context: PresenceViewContext<Message>,
  h: HtmlBuilder<Message | PresenceMessage>,
): Html => {
  const totalSize = context.group.sources.reduce(
    (total, sourceId) => total + (context.group.sourceMeta[sourceId]?.size ?? 0),
    0,
  );

  return h.div(
    [h.Class("group-books")],
    [
      ...(permits(context.viewerRole, GroupAction.ManageBackups)
        ? [...context.backupControls]
        : []),
      h.p(
        [h.Class("group-books-summary label")],
        [
          `${context.group.sources.length} ${context.group.sources.length === 1 ? "book" : "books"} · ${formatBytes(totalSize)} total`,
        ],
      ),
      h.ul(
        [h.Class("group-books-list")],
        context.group.sources.map((sourceId) => bookRowView(model, context, sourceId, h)),
      ),
    ],
  );
};

const imagesView = <Message>(
  model: PresenceModel,
  context: PresenceViewContext<Message>,
  h: HtmlBuilder<Message | PresenceMessage>,
): Html => {
  const count = model.images?.length ?? 0;

  return h.div(
    [h.Class("group-images")],
    [
      h.p(
        [h.Class("group-books-summary label")],
        [
          `${count} ${count === 1 ? "image" : "images"} · ${formatBytes(model.imageTotalSize)} total`,
        ],
      ),
      ...(model.imageError === null
        ? []
        : [h.p([h.Class("group-images-error")], [model.imageError])]),
      ...(model.images === null && model.imageError === null
        ? [h.p([h.Class("group-images-loading")], ["Loading…"])]
        : []),
      ...(model.images === null
        ? []
        : [
            h.ul(
              [h.Class("group-images-list")],
              model.images.map((image, index) => {
                const visible = model.visibleImages.includes(image.id);
                return h.li(
                  [h.Key(image.id)],
                  [
                    h.div(
                      [h.Class("group-image-row")],
                      [
                        h.span(
                          [h.Class("group-image-info")],
                          [
                            h.strong([], [`image ${index + 1}`]),
                            h.span(
                              [],
                              [
                                `uploaded by ${image.uploaderName} · size ${formatBytes(image.size)}`,
                              ],
                            ),
                          ],
                        ),
                        h.div(
                          [h.Class("group-image-actions")],
                          [
                            h.button(
                              [
                                h.Type("button"),
                                h.Class("group-image-view"),
                                h.OnClick(ToggledImagePreview({ imageId: image.id })),
                                h.AriaExpanded(visible),
                              ],
                              [`[${visible ? "hide" : "view"}]`],
                            ),
                            ...(permits(context.viewerRole, GroupAction.DeleteAnyImage)
                              ? [
                                  h.button(
                                    [
                                      h.Type("button"),
                                      h.Class("group-book-icon"),
                                      h.Disabled(model.deletingId !== null),
                                      h.OnClick(
                                        RequestedImageDelete({
                                          imageId: image.id,
                                          size: image.size,
                                          index,
                                        }),
                                      ),
                                      h.AriaLabel(`Delete image ${index + 1}`),
                                      h.Title("Delete image"),
                                    ],
                                    [h.img([h.Src(trashIcon), h.Alt(""), h.AriaHidden(true)])],
                                  ),
                                ]
                              : []),
                          ],
                        ),
                      ],
                    ),
                    ...(visible
                      ? [
                          h.img([
                            h.Class("group-image-preview"),
                            h.Src(
                              `/groups/${model.groupRef}/images/${encodeURIComponent(image.id)}`,
                            ),
                            h.Alt(`Upload ${index + 1}`),
                          ]),
                        ]
                      : []),
                  ],
                );
              }),
            ),
          ]),
    ],
  );
};

const bookDeleteModalView = <Message>(
  model: PresenceModel,
  pending: { readonly sourceId: string; readonly title: string },
  h: HtmlBuilder<Message | PresenceMessage>,
): Html => {
  const deleting = model.deletingId === pending.sourceId;
  const matches = model.bookDeleteTitleDraft === pending.title;

  return modalView(
    { title: "delete book", className: "book-delete-modal", onClose: CancelledBookDelete() },
    h,
    [
      h.form(
        [h.Class("modal-body book-delete-confirm-body"), h.OnSubmit(SubmittedBookDelete())],
        [
          h.p(
            [],
            [
              "Deleting this book will permanently remove ",
              h.strong([], [pending.title]),
              " and all of its notes for everyone in the club.",
            ],
          ),
          h.p(
            [h.Class("book-delete-backup-warning")],
            [
              "We strongly recommend backing up your notes before continuing. This cannot be undone.",
            ],
          ),
          h.label(
            [h.For("book-delete-title")],
            ["Type the full book name, ", h.strong([], [pending.title]), ", to confirm."],
          ),
          h.input([
            h.Id("book-delete-title"),
            h.Value(model.bookDeleteTitleDraft),
            h.Autocomplete("off"),
            h.Autofocus(true),
            h.OnInput((title) => ChangedBookDeleteTitle({ title })),
          ]),
          h.div(
            [h.Class("book-delete-final-actions")],
            [
              h.button(
                [h.Type("button"), h.Disabled(deleting), h.OnClick(CancelledBookDelete())],
                ["cancel"],
              ),
              h.button(
                [h.Type("submit"), h.Disabled(!matches || deleting)],
                [deleting ? "deleting…" : "delete book and notes"],
              ),
            ],
          ),
        ],
      ),
    ],
  );
};

const PRESENCE_TABS = [
  { id: "people", label: "People", title: "People and invitations" },
  { id: "books", label: "Books", title: "Book club library" },
  { id: "images", label: "Images", title: "Book club images" },
] as const;

export const presenceView = <Message>(
  model: PresenceModel,
  context: PresenceViewContext<Message>,
  h: HtmlBuilder<Message | PresenceMessage>,
): Html => {
  if (model.pendingBookDelete !== null) {
    return bookDeleteModalView(model, model.pendingBookDelete, h);
  }

  const page =
    model.page === "people"
      ? [...context.inviteControls]
      : model.page === "books"
        ? [booksView(model, context, h)]
        : [imagesView(model, context, h)];

  return modalView({ title: "group", className: "modal--invite", onClose: context.onClose }, h, [
    h.div([h.Class("modal-body group-modal-body")], page),
    modalTabsView(
      [...PRESENCE_TABS],
      model.page,
      (id) => ChangedPresencePage({ page: id }),
      h,
      "settings-tabs",
    ),
  ]);
};

/** The always-on header affordance: how many readers are here, and the press
 *  that opens the modal above. */
export const presenceIndicatorView = <Message>(
  onlineCount: number,
  onShowPeople: Message,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Type("button"),
      h.Class("presence-indicator"),
      h.OnClick(onShowPeople),
      h.AriaLabel(`${onlineCount} people online — show group`),
      h.Title("Show group"),
    ],
    [
      h.span([h.Class("presence-count")], [String(onlineCount)]),
      h.span([h.Class("presence-dot"), h.AriaHidden(true)], []),
    ],
  );
