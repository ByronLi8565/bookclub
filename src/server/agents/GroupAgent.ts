import { Agent, getAgentByName } from "agents";
import type {
  GroupRole,
  GroupSummary,
  RosterEntry,
  SourceMeta,
} from "../../shared/types/groups.ts";
import { slugForGroup } from "../../shared/groupUrls.ts";
import { canonicalEmail, randomHexToken } from "../../shared/util.ts";
import type { Env } from "../env.ts";

export interface Member {
  role: GroupRole;
  name: string;
  email: string;
  joinedAt: string;
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

export type CreateResult =
  | { ok: true; summary: GroupSummary }
  | { ok: false; reason: "exists" | "empty" };
export type InviteResult =
  | { ok: true; token: string }
  | { ok: false; reason: "not_member" | "not_found" };
export type RedeemResult =
  | { ok: true; summary: GroupSummary }
  | { ok: false; reason: "not_found" | "bad_invite" | "wrong_email" };
export type AddSourceResult =
  | { ok: true; summary: GroupSummary }
  | { ok: false; reason: "not_member" | "not_found" };
export type InviteLinkResult =
  | { ok: true; token: string }
  | { ok: false; reason: "not_member" | "not_found" };
export type RenameResult =
  | { ok: true; summary: GroupSummary }
  | { ok: false; reason: "not_member" | "not_found" | "bad_source" | "empty" };
export type RenameGroupResult =
  | { ok: true; summary: GroupSummary }
  | { ok: false; reason: "not_member" | "not_found" | "empty" };

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
    if (this.state.groupId !== "") return { ok: false, reason: "exists" };
    const title = displayName.trim();
    if (title === "") return { ok: false, reason: "empty" };

    const now = new Date().toISOString();
    this.setState({
      groupId: this.name,
      name: slugForGroup(title),
      publicId,
      displayName: title.slice(0, MAX_TITLE_LENGTH),
      ownerId: owner.id,
      members: {
        [owner.id]: { role: "owner", name: owner.name, email: owner.email, joinedAt: now },
      },
      sources: [],
      sourceMeta: {},
      invites: {},
      openInvite: "",
      bookTitles: {},
      createdAt: now,
    });
    await this.indexFor(owner.email);
    return { ok: true, summary: this.summary() };
  }

  // The shared precondition for every member-only mutation: the group must
  // exist and the caller must already belong to it. Returning the failure shape
  // directly lets callers `if (!guard.ok) return guard;`.
  private requireMember(
    callerId: string,
  ): { ok: true } | { ok: false; reason: "not_found" | "not_member" } {
    if (this.state.groupId === "") return { ok: false, reason: "not_found" };
    if (!this.state.members[callerId]) return { ok: false, reason: "not_member" };
    return { ok: true };
  }

  invite(callerId: string, email: string): InviteResult {
    const guard = this.requireMember(callerId);
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

  async redeem(t: string, user: Identity): Promise<RedeemResult> {
    if (this.state.groupId === "") return { ok: false, reason: "not_found" };
    if (this.state.members[user.id]) return { ok: true, summary: this.summary() };

    if (this.state.openInvite !== "" && t === this.state.openInvite) {
      await this.join(user, this.state.invites);
      return { ok: true, summary: this.summary() };
    }

    const invite = this.state.invites[t];
    if (!invite) return { ok: false, reason: "bad_invite" };
    if (invite.email !== canonicalEmail(user.email)) return { ok: false, reason: "wrong_email" };

    const { [t]: _used, ...rest } = this.state.invites;
    await this.join(user, rest);
    return { ok: true, summary: this.summary() };
  }

  ensureOpenInvite(callerId: string): InviteLinkResult {
    const guard = this.requireMember(callerId);
    if (!guard.ok) return guard;
    if (this.state.openInvite === "") this.setState({ ...this.state, openInvite: token() });
    return { ok: true, token: this.state.openInvite };
  }

  rotateOpenInvite(callerId: string): InviteLinkResult {
    const guard = this.requireMember(callerId);
    if (!guard.ok) return guard;
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
    }));
  }

  renameGroup(callerId: string, rawTitle: string): RenameGroupResult {
    const guard = this.requireMember(callerId);
    if (!guard.ok) return guard;
    const title = rawTitle.trim();
    if (title === "") return { ok: false, reason: "empty" };
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
    if (!this.state.sources.includes(sourceId)) return { ok: false, reason: "bad_source" };
    const title = rawTitle.trim();
    if (title === "") return { ok: false, reason: "empty" };
    this.setState({
      ...this.state,
      bookTitles: { ...this.state.bookTitles, [sourceId]: title.slice(0, MAX_TITLE_LENGTH) },
    });
    return { ok: true, summary: this.summary() };
  }

  resolveBookTitle(callerId: string, sourceId: string, rawTitle: string): RenameResult {
    const guard = this.requireMember(callerId);
    if (!guard.ok) return guard;
    if (!this.state.sources.includes(sourceId)) return { ok: false, reason: "bad_source" };
    const title = rawTitle.trim();
    if (title === "") return { ok: false, reason: "empty" };
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
        [user.id]: { role: "member", name: user.name, email: user.email, joinedAt: now },
      },
      invites,
    });
    await this.indexFor(user.email);
  }

  addSource(callerId: string, sourceId: string, meta: SourceMeta): AddSourceResult {
    const guard = this.requireMember(callerId);
    if (!guard.ok) return guard;
    const sources = this.state.sources.includes(sourceId)
      ? this.state.sources
      : [...this.state.sources, sourceId];
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

  getSummary(): GroupSummary | null {
    return this.state.groupId === "" ? null : this.summary();
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
      sourceMeta: this.state.sourceMeta ?? {},
      memberCount: Object.keys(this.state.members).length,
    };
  }

  private async indexFor(email: string): Promise<void> {
    const auth = await getAgentByName(this.env.AuthAgent, canonicalEmail(email));
    await auth.addGroup(this.name);
  }
}
