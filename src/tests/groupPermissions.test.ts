import { describe, expect, it } from "vitest";
import { ACTION_MINIMUM_ROLE, GroupAction, permits } from "../shared/groupPermissions.ts";
import { GroupRole } from "../shared/types/groups.ts";

describe("group permissions", () => {
  it("keeps every action in the policy table", () => {
    expect(Object.keys(ACTION_MINIMUM_ROLE).toSorted()).toEqual(
      Object.values(GroupAction).toSorted(),
    );
  });

  it("gives visitors read-only access", () => {
    expect(permits(GroupRole.Visitor, GroupAction.ViewClub)).toBe(true);
    expect(permits(GroupRole.Visitor, GroupAction.ReadBook)).toBe(true);
    expect(permits(GroupRole.Visitor, GroupAction.CreateNote)).toBe(false);
    expect(permits(GroupRole.Visitor, GroupAction.InviteMember)).toBe(false);
  });

  it("lets members contribute without administering the club", () => {
    expect(permits(GroupRole.Member, GroupAction.CreateNote)).toBe(true);
    expect(permits(GroupRole.Member, GroupAction.UploadBook)).toBe(true);
    expect(permits(GroupRole.Member, GroupAction.DeleteOwnBook)).toBe(true);
    expect(permits(GroupRole.Member, GroupAction.EditOwnBookMetadata)).toBe(true);
    expect(permits(GroupRole.Member, GroupAction.DeleteAnyBook)).toBe(false);
    expect(permits(GroupRole.Member, GroupAction.EditAnyBookMetadata)).toBe(false);
    expect(permits(GroupRole.Member, GroupAction.DeleteAnyImage)).toBe(false);
    expect(permits(GroupRole.Member, GroupAction.RenameBook)).toBe(false);
    expect(permits(GroupRole.Member, GroupAction.RenameClub)).toBe(false);
  });

  it("lets admins do everything except owner-level actions", () => {
    for (const action of Object.values(GroupAction)) {
      const expected =
        action !== GroupAction.ChangeAdminRole &&
        action !== GroupAction.ManageBackups &&
        action !== GroupAction.DeleteClub;
      expect(permits(GroupRole.Admin, action), action).toBe(expected);
    }
  });

  it("lets owners perform every action", () => {
    for (const action of Object.values(GroupAction)) {
      expect(permits(GroupRole.Owner, action), action).toBe(true);
    }
  });
});
