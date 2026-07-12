import { Agent, getAgentByName } from "agents";
import {
  GroupFailureReason,
  GroupRole,
  type BookMetadataPatch,
  type GroupSummary,
  type RosterEntry,
  type SourceMeta,
} from "../../shared/types/groups.ts";
import { slugForGroup } from "../../shared/groupUrls.ts";
import { randomHexToken } from "../../shared/crypto.ts";
import { canonicalEmail } from "../../shared/email.ts";
import type { Env } from "../env.ts";
import { GroupAction, permits } from "../../shared/groupPermissions.ts";

export interface Member {
  role: GroupRole;
  name: string;
  email: string;
  joinedAt: string;
  avatarImageId?: string;
}

interface Invite {
  email: string;
  createdAt: number;
}

export interface GroupState {
  groupId: string;
  name: string;
  publicId: string;
  displayName: string;
  ownerId: string;
  members: Record<string, Member>;
  sources: string[];
  sourceMeta: Record<string, SourceMeta>;
  invites: Record<string, Invite>;
  openInvite: string;
  bookTitles: Record<string, string>;
  createdAt: string;
}

export interface Identity {
  id: string;
  name: string;
  email: string;
}

type GroupFailure<R extends GroupFailureReason> = { ok: false; reason: R };
type AccessFailureReason =
  | typeof GroupFailureReason.NotMember
  | typeof GroupFailureReason.NotFound
  | typeof GroupFailureReason.Forbidden;

export type CreateResult =
  | { ok: true; summary: GroupSummary }
  | GroupFailure<typeof GroupFailureReason.Exists | typeof GroupFailureReason.Empty>;
export type InviteResult = { ok: true; token: string } | GroupFailure<AccessFailureReason>;
export type RedeemResult =
  | { ok: true; summary: GroupSummary }
  | GroupFailure<
      | typeof GroupFailureReason.NotFound
      | typeof GroupFailureReason.BadInvite
      | typeof GroupFailureReason.WrongEmail
    >;
export type AddSourceResult =
  | { ok: true; summary: GroupSummary }
  | GroupFailure<AccessFailureReason>;
export type InviteLinkResult = { ok: true; token: string } | GroupFailure<AccessFailureReason>;
export type RenameResult =
  | { ok: true; summary: GroupSummary }
  | GroupFailure<
      AccessFailureReason | typeof GroupFailureReason.BadSource | typeof GroupFailureReason.Empty
    >;
export type RenameGroupResult =
  | { ok: true; summary: GroupSummary }
  | GroupFailure<AccessFailureReason | typeof GroupFailureReason.Empty>;
export type SetRoleResult =
  | { ok: true; roster: RosterEntry[] }
  | GroupFailure<AccessFailureReason | typeof GroupFailureReason.BadMember>;
export type DeleteSourceResult =
  | { ok: true; summary: GroupSummary }
  | GroupFailure<AccessFailureReason | typeof GroupFailureReason.BadSource>;
export type DeleteGroupResult =
  | { ok: true; groupId: string; publicId: string; members: Identity[] }
  | GroupFailure<AccessFailureReason>;

const MAX_TITLE_LENGTH = 100;

function token(): string {
  return randomHexToken(16);
}

export class GroupAgent extends Agent<Env, GroupState> {
  initialState: GroupState = {
    groupId: "",
    name: "",
    publicId: "",
    displayName: "",
    ownerId: "",
    members: {},
    sources: [],
    sourceMeta: {},
    invites: {},
    openInvite: "",
    bookTitles: {},
    createdAt: "",
  };

  async create(displayName: string, publicId: string, owner: Identity): Promise<CreateResult> {
    if (this.state.groupId !== "") return { ok: false, reason: GroupFailureReason.Exists };
    const title = displayName.trim();
    if (title === "") return { ok: false, reason: GroupFailureReason.Empty };

    const now = new Date().toISOString();
    this.setState({
      groupId: this.name,
      name: slugForGroup(title),
      publicId,
      displayName: title.slice(0, MAX_TITLE_LENGTH),
      ownerId: owner.id,
      members: {
        [owner.id]: { role: GroupRole.Owner, name: owner.name, email: owner.email, joinedAt: now },
      },
      sources: [],
      sourceMeta: {},
      invites: {},
      openInvite: "",
      bookTitles: {},
      createdAt: now,
    });
    await this.indexFor(owner);
    return { ok: true, summary: this.summary() };
  }

  // The shared precondition for every member-only mutation: the group must
  // exist and the caller must already belong to it. Returning the failure shape
  // directly lets callers `if (!guard.ok) return guard;`.
  private requireMember(
    callerId: string,
  ):
    | { ok: true; role: GroupRole }
    | GroupFailure<typeof GroupFailureReason.NotFound | typeof GroupFailureReason.NotMember> {
    if (this.state.groupId === "") return { ok: false, reason: GroupFailureReason.NotFound };
    const member = this.state.members[callerId];
    if (!member) return { ok: false, reason: GroupFailureReason.NotMember };
    return { ok: true, role: member.role };
  }

  invite(callerId: string, email: string): InviteResult {
    const guard = this.requireMember(callerId);
    if (!guard.ok) return guard;
    if (!permits(guard.role, GroupAction.InviteMember)) {
      return { ok: false, reason: GroupFailureReason.Forbidden };
    }

    const normalized = canonicalEmail(email);
    const existing = Object.entries(this.state.invites).find(([, inv]) => inv.email === normalized);
    if (existing) return { ok: true, token: existing[0] };

    const t = token();
    this.setState({
      ...this.state,
      invites: { ...this.state.invites, [t]: { email: normalized, createdAt: Date.now() } },
    });
    return { ok: true, token: t };
  }

  async redeem(t: string, user: Identity): Promise<RedeemResult> {
    if (this.state.groupId === "") return { ok: false, reason: GroupFailureReason.NotFound };
    if (this.state.members[user.id]) return { ok: true, summary: this.summary() };

    if (this.state.openInvite !== "" && t === this.state.openInvite) {
      await this.join(user, this.state.invites);
      return { ok: true, summary: this.summary() };
    }

    const invite = this.state.invites[t];
    if (!invite) return { ok: false, reason: GroupFailureReason.BadInvite };
    if (invite.email !== canonicalEmail(user.email)) {
      return { ok: false, reason: GroupFailureReason.WrongEmail };
    }

    const { [t]: _used, ...rest } = this.state.invites;
    await this.join(user, rest);
    return { ok: true, summary: this.summary() };
  }

  ensureOpenInvite(callerId: string): InviteLinkResult {
    const guard = this.requireMember(callerId);
    if (!guard.ok) return guard;
    if (!permits(guard.role, GroupAction.InviteMember)) {
      return { ok: false, reason: GroupFailureReason.Forbidden };
    }
    if (this.state.openInvite === "") this.setState({ ...this.state, openInvite: token() });
    return { ok: true, token: this.state.openInvite };
  }

  rotateOpenInvite(callerId: string): InviteLinkResult {
    const guard = this.requireMember(callerId);
    if (!guard.ok) return guard;
    if (!permits(guard.role, GroupAction.InviteMember)) {
      return { ok: false, reason: GroupFailureReason.Forbidden };
    }
    const t = token();
    this.setState({ ...this.state, openInvite: t });
    return { ok: true, token: t };
  }

  roster(): RosterEntry[] {
    return Object.entries(this.state.members).map(([id, m]) => ({
      id,
      name: m.name,
      email: m.email,
      role: m.role,
      ...(m.avatarImageId ? { avatarImageId: m.avatarImageId } : {}),
    }));
  }

  memberProfile(userId: string): RosterEntry | null {
    const member = this.state.members[userId];
    if (!member) return null;
    return {
      id: userId,
      name: member.name,
      email: member.email,
      role: member.role,
      ...(member.avatarImageId ? { avatarImageId: member.avatarImageId } : {}),
    };
  }

  setMemberProfile(userId: string, name: string, avatarImageId?: string): RosterEntry | null {
    const member = this.state.members[userId];
    if (!member) return null;
    const { avatarImageId: _oldAvatar, ...base } = member;
    const next = { ...base, name, ...(avatarImageId ? { avatarImageId } : {}) };
    if (next.name !== member.name || next.avatarImageId !== member.avatarImageId) {
      this.setState({ ...this.state, members: { ...this.state.members, [userId]: next } });
    }
    return {
      id: userId,
      name: next.name,
      email: next.email,
      role: next.role,
      ...(next.avatarImageId ? { avatarImageId: next.avatarImageId } : {}),
    };
  }

  renameGroup(callerId: string, rawTitle: string): RenameGroupResult {
    const guard = this.requireMember(callerId);
    if (!guard.ok) return guard;
    if (!permits(guard.role, GroupAction.RenameClub)) {
      return { ok: false, reason: GroupFailureReason.Forbidden };
    }
    const title = rawTitle.trim();
    if (title === "") return { ok: false, reason: GroupFailureReason.Empty };
    this.setState({
      ...this.state,
      name: slugForGroup(title),
      displayName: title.slice(0, MAX_TITLE_LENGTH),
    });
    return { ok: true, summary: this.summary() };
  }

  assignPublicUrl(publicId: string): GroupSummary | null {
    if (this.state.groupId === "") return null;
    if (this.state.publicId) return this.summary();
    this.setState({ ...this.state, name: slugForGroup(this.state.displayName), publicId });
    return this.summary();
  }

  renameBook(callerId: string, sourceId: string, rawTitle: string): RenameResult {
    const guard = this.requireMember(callerId);
    if (!guard.ok) return guard;
    if (!permits(guard.role, GroupAction.RenameBook)) {
      return { ok: false, reason: GroupFailureReason.Forbidden };
    }
    if (!this.state.sources.includes(sourceId))
      return { ok: false, reason: GroupFailureReason.BadSource };
    const title = rawTitle.trim();
    if (title === "") return { ok: false, reason: GroupFailureReason.Empty };
    this.setState({
      ...this.state,
      bookTitles: { ...this.state.bookTitles, [sourceId]: title.slice(0, MAX_TITLE_LENGTH) },
    });
    return { ok: true, summary: this.summary() };
  }

  resolveBookTitle(callerId: string, sourceId: string, rawTitle: string): RenameResult {
    const guard = this.requireMember(callerId);
    if (!guard.ok) return guard;
    if (!permits(guard.role, GroupAction.RenameBook)) {
      return { ok: false, reason: GroupFailureReason.Forbidden };
    }
    if (!this.state.sources.includes(sourceId))
      return { ok: false, reason: GroupFailureReason.BadSource };
    const title = rawTitle.trim();
    if (title === "") return { ok: false, reason: GroupFailureReason.Empty };
    const meta = this.state.sourceMeta[sourceId];
    if (!meta || (meta.title ?? "") !== "") return { ok: true, summary: this.summary() };
    this.setState({
      ...this.state,
      sourceMeta: {
        ...this.state.sourceMeta,
        [sourceId]: { ...meta, title: title.slice(0, MAX_TITLE_LENGTH) },
      },
    });
    return { ok: true, summary: this.summary() };
  }

  private async join(user: Identity, invites: Record<string, Invite>): Promise<void> {
    const now = new Date().toISOString();
    this.setState({
      ...this.state,
      members: {
        ...this.state.members,
        [user.id]: { role: GroupRole.Member, name: user.name, email: user.email, joinedAt: now },
      },
      invites,
    });
    await this.indexFor(user);
  }

  addSource(callerId: string, sourceId: string, meta: SourceMeta): AddSourceResult {
    const guard = this.requireMember(callerId);
    if (!guard.ok) return guard;
    if (!permits(guard.role, GroupAction.UploadBook)) {
      return { ok: false, reason: GroupFailureReason.Forbidden };
    }
    if (this.state.sources.includes(sourceId)) return { ok: true, summary: this.summary() };
    const sources = [...this.state.sources, sourceId];
    this.setState({
      ...this.state,
      sources,
      sourceMeta: { ...this.state.sourceMeta, [sourceId]: meta },
    });
    return { ok: true, summary: this.summary() };
  }

  membership(userId: string): { isMember: boolean; role: GroupRole | null } {
    const member = this.state.members[userId];
    return member ? { isMember: true, role: member.role } : { isMember: false, role: null };
  }

  setMemberRole(callerId: string, memberId: string, role: GroupRole): SetRoleResult {
    const guard = this.requireMember(callerId);
    if (!guard.ok) return guard;
    const target = this.state.members[memberId];
    if (!target) return { ok: false, reason: GroupFailureReason.BadMember };
    if (target.role === GroupRole.Owner || role === GroupRole.Owner) {
      return { ok: false, reason: GroupFailureReason.Forbidden };
    }
    const action =
      target.role === GroupRole.Admin || role === GroupRole.Admin
        ? GroupAction.ChangeAdminRole
        : GroupAction.ChangeMemberRole;
    if (!permits(guard.role, action)) return { ok: false, reason: GroupFailureReason.Forbidden };
    this.setState({
      ...this.state,
      members: { ...this.state.members, [memberId]: { ...target, role } },
    });
    return { ok: true, roster: this.roster() };
  }

  deleteSource(callerId: string, sourceId: string): DeleteSourceResult {
    const guard = this.requireMember(callerId);
    if (!guard.ok) return guard;
    const meta = this.state.sourceMeta[sourceId];
    if (!meta || !this.state.sources.includes(sourceId)) {
      return { ok: false, reason: GroupFailureReason.BadSource };
    }
    const action =
      callerId === (meta.addedBy || this.state.ownerId)
        ? GroupAction.DeleteOwnBook
        : GroupAction.DeleteAnyBook;
    if (!permits(guard.role, action)) {
      return { ok: false, reason: GroupFailureReason.Forbidden };
    }
    const { [sourceId]: _meta, ...sourceMeta } = this.state.sourceMeta;
    const { [sourceId]: _title, ...bookTitles } = this.state.bookTitles;
    this.setState({
      ...this.state,
      sources: this.state.sources.filter((id) => id !== sourceId),
      sourceMeta,
      bookTitles,
    });
    return { ok: true, summary: this.summary() };
  }

  updateBookMetadata(callerId: string, sourceId: string, patch: BookMetadataPatch): RenameResult {
    const guard = this.requireMember(callerId);
    if (!guard.ok) return guard;
    const meta = this.state.sourceMeta[sourceId];
    if (!meta || !this.state.sources.includes(sourceId)) {
      return { ok: false, reason: GroupFailureReason.BadSource };
    }
    const action =
      callerId === (meta.addedBy || this.state.ownerId)
        ? GroupAction.EditOwnBookMetadata
        : GroupAction.EditAnyBookMetadata;
    if (!permits(guard.role, action)) {
      return { ok: false, reason: GroupFailureReason.Forbidden };
    }
    this.setState({
      ...this.state,
      sourceMeta: { ...this.state.sourceMeta, [sourceId]: { ...meta, ...patch } },
    });
    return { ok: true, summary: this.summary() };
  }

  deleteGroup(callerId: string): DeleteGroupResult {
    const guard = this.requireMember(callerId);
    if (!guard.ok) return guard;
    if (!permits(guard.role, GroupAction.DeleteClub)) {
      return { ok: false, reason: GroupFailureReason.Forbidden };
    }
    const result = {
      ok: true as const,
      groupId: this.state.groupId,
      publicId: this.state.publicId,
      members: Object.entries(this.state.members).map(([id, member]) => ({
        id,
        name: member.name,
        email: member.email,
      })),
    };
    this.setState({
      ...this.initialState,
      members: {},
      sources: [],
      sourceMeta: {},
      invites: {},
      bookTitles: {},
    });
    return result;
  }

  getSummary(): GroupSummary | null {
    return this.state.groupId === "" ? null : this.summary();
  }

  exportState(): GroupState {
    return { ...this.state, sourceMeta: this.normalizedSourceMeta() };
  }

  importState(state: GroupState): void {
    this.setState({
      ...state,
      sourceMeta: Object.fromEntries(
        Object.entries(state.sourceMeta ?? {}).map(([id, meta]) => [
          id,
          { ...meta, addedBy: meta.addedBy || state.ownerId },
        ]),
      ),
    });
  }

  private summary(): GroupSummary {
    return {
      groupId: this.state.groupId,
      slug: this.state.name || slugForGroup(this.state.displayName),
      publicId: this.state.publicId ?? "",
      displayName: this.state.displayName,
      ownerId: this.state.ownerId,
      sources: this.state.sources ?? [],
      bookTitles: this.state.bookTitles ?? {},
      sourceMeta: this.normalizedSourceMeta(),
      memberCount: Object.keys(this.state.members).length,
    };
  }

  private normalizedSourceMeta(): Record<string, SourceMeta> {
    return Object.fromEntries(
      Object.entries(this.state.sourceMeta ?? {}).map(([id, meta]) => [
        id,
        { ...meta, addedBy: meta.addedBy || this.state.ownerId },
      ]),
    );
  }

  // Re-link this group into a member's account index. Safe to call repeatedly
  // (AuthAgent.addGroup dedupes); lets a member's club list self-heal on view
  // if it ever drifted out of sync with actual membership.
  async reindexMember(user: Identity): Promise<void> {
    if (this.state.members[user.id]) await this.indexFor(user);
  }

  private async indexFor(user: Identity): Promise<void> {
    const auth = await getAgentByName(this.env.AuthAgent, canonicalEmail(user.email));
    await auth.addGroup(this.name, user);
  }
}
