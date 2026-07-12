import { GroupRole } from "./types/groups.ts";

export const GroupAction = {
  ViewClub: "view-club",
  ViewRoster: "view-roster",
  ReadBook: "read-book",
  TrackReadingPosition: "track-reading-position",
  CreateNote: "create-note",
  ReplyToNote: "reply-to-note",
  EditOwnNote: "edit-own-note",
  DeleteOwnNote: "delete-own-note",
  RebindOwnHighlight: "rebind-own-highlight",
  RebindAnyHighlight: "rebind-any-highlight",
  UploadNoteImage: "upload-note-image",
  DeleteAnyImage: "delete-any-image",
  InviteMember: "invite-member",
  UploadBook: "upload-book",
  DeleteOwnBook: "delete-own-book",
  EditOwnBookMetadata: "edit-own-book-metadata",
  RenameBook: "rename-book",
  DeleteAnyBook: "delete-any-book",
  EditAnyBookMetadata: "edit-any-book-metadata",
  ModerateNotes: "moderate-notes",
  RenameClub: "rename-club",
  ChangeMemberRole: "change-member-role",
  ChangeAdminRole: "change-admin-role",
  ManageBackups: "manage-backups",
  DeleteClub: "delete-club",
} as const;

export type GroupAction = (typeof GroupAction)[keyof typeof GroupAction];

const ROLE_LEVEL: Record<GroupRole, number> = {
  [GroupRole.Visitor]: 0,
  [GroupRole.Member]: 1,
  [GroupRole.Admin]: 2,
  [GroupRole.Owner]: 3,
};

export const ACTION_MINIMUM_ROLE = {
  [GroupAction.ViewClub]: GroupRole.Visitor,
  [GroupAction.ViewRoster]: GroupRole.Visitor,
  [GroupAction.ReadBook]: GroupRole.Visitor,
  [GroupAction.TrackReadingPosition]: GroupRole.Visitor,
  [GroupAction.CreateNote]: GroupRole.Member,
  [GroupAction.ReplyToNote]: GroupRole.Member,
  [GroupAction.EditOwnNote]: GroupRole.Member,
  [GroupAction.DeleteOwnNote]: GroupRole.Member,
  [GroupAction.RebindOwnHighlight]: GroupRole.Member,
  [GroupAction.RebindAnyHighlight]: GroupRole.Admin,
  [GroupAction.UploadNoteImage]: GroupRole.Member,
  [GroupAction.DeleteAnyImage]: GroupRole.Admin,
  [GroupAction.InviteMember]: GroupRole.Member,
  [GroupAction.UploadBook]: GroupRole.Member,
  [GroupAction.DeleteOwnBook]: GroupRole.Member,
  [GroupAction.EditOwnBookMetadata]: GroupRole.Member,
  [GroupAction.RenameBook]: GroupRole.Admin,
  [GroupAction.DeleteAnyBook]: GroupRole.Admin,
  [GroupAction.EditAnyBookMetadata]: GroupRole.Admin,
  [GroupAction.ModerateNotes]: GroupRole.Admin,
  [GroupAction.RenameClub]: GroupRole.Admin,
  [GroupAction.ChangeMemberRole]: GroupRole.Admin,
  [GroupAction.ChangeAdminRole]: GroupRole.Owner,
  [GroupAction.ManageBackups]: GroupRole.Owner,
  [GroupAction.DeleteClub]: GroupRole.Owner,
} as const satisfies Record<GroupAction, GroupRole>;

export function permits(role: GroupRole, action: GroupAction): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[ACTION_MINIMUM_ROLE[action]];
}
