import { getAgentByName } from "agents";
import { ServerOwnedAgent } from "./serverOwnedAgent.ts";
import * as Encoding from "effect/Encoding";
import {
  GroupFailureReason,
  GroupRole,
  type BookMetadataPatch,
  type GroupSummary,
  type RosterEntry,
  type SourceMeta,
} from "../../shared/types/groups.ts";
import { slugForGroup } from "../../shared/groupUrls.ts";
import { canonicalEmail } from "../../shared/email.ts";
import { deleteImagesForScope } from "../services/images.ts";
import { REGISTRY_ID } from "./registryId.ts";
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
  /** Set when the Group is deleted: who still holds it in their account index. */
  pendingDeletion?: { members: Identity[] };
}

export interface Identity {
  id: string;
  name: string;
  email: string;
}

type GroupFailure = { ok: false; reason: GroupFailureReason };

/** A Group Control Plane answer: the payload on success, else the refusal the HTTP seam translates. */
export type GroupResult<A extends object = object> = ({ ok: true } & A) | GroupFailure;

export interface GroupView {
  group: GroupSummary;
  membership: { isMember: boolean; role: GroupRole | null };
  members: RosterEntry[];
}

function token(): string {
  return Encoding.encodeHex(crypto.getRandomValues(new Uint8Array(16)));
}

function rosterEntry(id: string, member: Member): RosterEntry {
  const entry: RosterEntry = { id, name: member.name, email: member.email, role: member.role };
  return member.avatarImageId ? { ...entry, avatarImageId: member.avatarImageId } : entry;
}

export class GroupAgent extends ServerOwnedAgent<Env, GroupState> {
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

  async create(
    displayName: string,
    publicId: string,
    owner: Identity,
  ): Promise<GroupResult<{ summary: GroupSummary }>> {
    if (this.state.groupId !== "") return { ok: false, reason: GroupFailureReason.Exists };
    const now = new Date().toISOString();
    this.setState({
      groupId: this.name,
      name: slugForGroup(displayName),
      publicId,
      displayName,
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
    await this.indexMember(owner);
    return { ok: true, summary: this.summary() };
  }

  // The shared precondition for every member-only mutation: the group must
  // exist and the caller must already belong to it. Returning the failure shape
  // directly lets callers `if (!guard.ok) return guard;`.
  private requireMember(callerId: string): GroupResult<{ role: GroupRole }> {
    if (this.state.groupId === "") return { ok: false, reason: GroupFailureReason.NotFound };
    const member = this.state.members[callerId];
    if (!member) return { ok: false, reason: GroupFailureReason.NotMember };
    return { ok: true, role: member.role };
  }

  private requireAction(callerId: string, action: GroupAction): GroupResult<{ role: GroupRole }> {
    const guard = this.requireMember(callerId);
    if (!guard.ok) return guard;
    return permits(guard.role, action)
      ? guard
      : { ok: false, reason: GroupFailureReason.Forbidden };
  }

  invite(callerId: string, email: string): GroupResult<{ token: string }> {
    const guard = this.requireAction(callerId, GroupAction.InviteMember);
    if (!guard.ok) return guard;

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

  async redeem(t: string, user: Identity): Promise<GroupResult<{ summary: GroupSummary }>> {
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

  ensureOpenInvite(callerId: string): GroupResult<{ token: string }> {
    const guard = this.requireAction(callerId, GroupAction.InviteMember);
    if (!guard.ok) return guard;
    if (this.state.openInvite === "") this.setState({ ...this.state, openInvite: token() });
    return { ok: true, token: this.state.openInvite };
  }

  rotateOpenInvite(callerId: string): GroupResult<{ token: string }> {
    const guard = this.requireAction(callerId, GroupAction.InviteMember);
    if (!guard.ok) return guard;
    const t = token();
    this.setState({ ...this.state, openInvite: t });
    return { ok: true, token: t };
  }

  roster(): RosterEntry[] {
    return Object.entries(this.state.members).map(([id, member]) => rosterEntry(id, member));
  }

  memberProfile(userId: string): RosterEntry | null {
    const member = this.state.members[userId];
    return member ? rosterEntry(userId, member) : null;
  }

  /** What `userId` may see of the Group: everything for a member; for anyone
   *  else only enough to recognise the club and redeem an invite to it. */
  view(user: Identity): GroupView | null {
    if (this.state.groupId === "") return null;
    const member = this.state.members[user.id];
    if (!member) {
      return {
        group: { ...this.summary(), sources: [], bookTitles: {}, sourceMeta: {} },
        membership: { isMember: false, role: null },
        members: [],
      };
    }
    // Re-links a club list that drifted before joins reconciled durably. Off
    // the response path: the add is a no-op once the index holds the Group.
    this.ctx.waitUntil(this.indexMember(user));
    return {
      group: this.summary(),
      membership: { isMember: true, role: member.role },
      members: this.roster(),
    };
  }

  async setMemberProfile(
    userId: string,
    name: string,
    avatarImageId?: string,
  ): Promise<RosterEntry | null> {
    const member = this.state.members[userId];
    if (!member) return null;
    const { avatarImageId: _oldAvatar, ...base } = member;
    const next = avatarImageId ? { ...base, name, avatarImageId } : { ...base, name };
    if (next.name !== member.name || avatarImageId !== member.avatarImageId) {
      this.setState({ ...this.state, members: { ...this.state.members, [userId]: next } });
      await this.projectMember(userId);
    }
    return rosterEntry(userId, next);
  }

  renameGroup(callerId: string, title: string): GroupResult<{ summary: GroupSummary }> {
    const guard = this.requireAction(callerId, GroupAction.RenameClub);
    if (!guard.ok) return guard;
    this.setState({ ...this.state, name: slugForGroup(title), displayName: title });
    return { ok: true, summary: this.summary() };
  }

  assignPublicUrl(publicId: string): GroupSummary | null {
    if (this.state.groupId === "") return null;
    if (this.state.publicId) return this.summary();
    this.setState({ ...this.state, name: slugForGroup(this.state.displayName), publicId });
    return this.summary();
  }

  renameBook(
    callerId: string,
    sourceId: string,
    title: string,
  ): GroupResult<{ summary: GroupSummary }> {
    const guard = this.requireAction(callerId, GroupAction.RenameBook);
    if (!guard.ok) return guard;
    if (!this.state.sources.includes(sourceId))
      return { ok: false, reason: GroupFailureReason.BadSource };
    this.setState({ ...this.state, bookTitles: { ...this.state.bookTitles, [sourceId]: title } });
    return { ok: true, summary: this.summary() };
  }

  resolveBookTitle(
    callerId: string,
    sourceId: string,
    title: string,
  ): GroupResult<{ summary: GroupSummary }> {
    const guard = this.requireAction(callerId, GroupAction.RenameBook);
    if (!guard.ok) return guard;
    if (!this.state.sources.includes(sourceId))
      return { ok: false, reason: GroupFailureReason.BadSource };
    const meta = this.state.sourceMeta[sourceId];
    if (!meta || (meta.title ?? "") !== "") return { ok: true, summary: this.summary() };
    this.setState({
      ...this.state,
      sourceMeta: { ...this.state.sourceMeta, [sourceId]: { ...meta, title } },
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
    await this.indexMember(user);
  }

  addSource(
    callerId: string,
    sourceId: string,
    meta: SourceMeta,
  ): GroupResult<{ summary: GroupSummary }> {
    const guard = this.requireAction(callerId, GroupAction.UploadBook);
    if (!guard.ok) return guard;
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

  async setMemberRole(
    callerId: string,
    memberId: string,
    role: GroupRole,
  ): Promise<GroupResult<{ roster: RosterEntry[] }>> {
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
    await this.projectMember(memberId);
    return { ok: true, roster: this.roster() };
  }

  deleteSource(callerId: string, sourceId: string): GroupResult<{ summary: GroupSummary }> {
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

  updateBookMetadata(
    callerId: string,
    sourceId: string,
    patch: BookMetadataPatch,
  ): GroupResult<{ summary: GroupSummary }> {
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

  /**
   * Deletion commits here first, so the Group is gone the moment this returns;
   * everything that still refers to it is released afterwards by
   * `finishDeletion`, which this object keeps retrying until it succeeds.
   */
  async deleteGroup(callerId: string): Promise<GroupResult> {
    const guard = this.requireAction(callerId, GroupAction.DeleteClub);
    if (!guard.ok) return guard;
    const members = Object.entries(this.state.members).map(([id, member]) => ({
      id,
      name: member.name,
      email: member.email,
    }));
    this.setState({ ...this.initialState, pendingDeletion: { members } });
    await this.schedule(0, "finishDeletion");
    return { ok: true };
  }

  // Every step is idempotent, and the tombstone is cleared last, so a retry
  // after any partial failure finishes the same work rather than orphaning it.
  async finishDeletion(): Promise<void> {
    const pending = this.state.pendingDeletion;
    if (!pending) return;
    await this.reconcile("finishDeletion", undefined, async () => {
      const registry = await getAgentByName(this.env.GroupRegistry, REGISTRY_ID);
      await registry.releaseGroup(this.name);
      await Promise.all(
        pending.members.map(async (member) => {
          const auth = await getAgentByName(this.env.AuthAgent, canonicalEmail(member.email));
          await auth.removeGroup(this.name);
        }),
      );
      await (await getAgentByName(this.env.NoteAgent, this.name)).clear();
      await deleteImagesForScope(this.env, this.name);
      const { pendingDeletion: _finished, ...state } = this.state;
      this.setState(state);
    });
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

  /** Links this Group into a member's account index (AuthAgent.addGroup dedupes). */
  async indexMember(user: Identity): Promise<void> {
    await this.reconcile("indexMember", user, async () => {
      if (!this.state.members[user.id]) return;
      const auth = await getAgentByName(this.env.AuthAgent, canonicalEmail(user.email));
      await auth.addGroup(this.name, user);
    });
  }

  /** Carries a member's current name, role, and avatar into live note connections. */
  async projectMember(memberId: string): Promise<void> {
    await this.reconcile("projectMember", memberId, async () => {
      const member = this.state.members[memberId];
      if (!member) return;
      const notes = await getAgentByName(this.env.NoteAgent, this.name);
      await notes.updateMember(memberId, member.name, member.role, member.avatarImageId);
    });
  }
}
