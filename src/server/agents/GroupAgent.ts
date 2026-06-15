import { Agent, getAgentByName } from "agents";
import type {
  GroupRole,
  GroupSummary,
  RosterEntry,
  SourceMeta,
} from "../../shared/types/groups.ts";
import type { Env } from "../env.ts";
import { REGISTRY_ID } from "./GroupRegistry.ts";
import type { NormalizedName } from "../util/names.ts";

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
  | { ok: false; reason: "exists" | "name_taken" };
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
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class GroupAgent extends Agent<Env, GroupState> {
  initialState: GroupState = {
    groupId: "",
    name: "",
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

  async create(name: NormalizedName, owner: Identity): Promise<CreateResult> {
    if (this.state.groupId !== "") return { ok: false, reason: "exists" };

    const registry = await getAgentByName(this.env.GroupRegistry, REGISTRY_ID);
    const reserved = await registry.reserve(name.key, this.name);
    if (!reserved.ok) return { ok: false, reason: "name_taken" };

    const now = new Date().toISOString();
    this.setState({
      groupId: this.name,
      name: name.key,
      displayName: name.display,
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

  invite(callerId: string, email: string): InviteResult {
    if (this.state.groupId === "") return { ok: false, reason: "not_found" };
    if (!this.state.members[callerId]) return { ok: false, reason: "not_member" };

    const normalized = email.trim().toLowerCase();
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
    if (invite.email !== user.email.trim().toLowerCase())
      return { ok: false, reason: "wrong_email" };

    const { [t]: _used, ...rest } = this.state.invites;
    await this.join(user, rest);
    return { ok: true, summary: this.summary() };
  }

  ensureOpenInvite(callerId: string): InviteLinkResult {
    if (this.state.groupId === "") return { ok: false, reason: "not_found" };
    if (!this.state.members[callerId]) return { ok: false, reason: "not_member" };
    if (this.state.openInvite === "") this.setState({ ...this.state, openInvite: token() });
    return { ok: true, token: this.state.openInvite };
  }

  rotateOpenInvite(callerId: string): InviteLinkResult {
    if (this.state.groupId === "") return { ok: false, reason: "not_found" };
    if (!this.state.members[callerId]) return { ok: false, reason: "not_member" };
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
    if (this.state.groupId === "") return { ok: false, reason: "not_found" };
    if (!this.state.members[callerId]) return { ok: false, reason: "not_member" };
    const title = rawTitle.trim();
    if (title === "") return { ok: false, reason: "empty" };
    this.setState({ ...this.state, displayName: title.slice(0, MAX_TITLE_LENGTH) });
    return { ok: true, summary: this.summary() };
  }

  renameBook(callerId: string, sourceId: string, rawTitle: string): RenameResult {
    if (this.state.groupId === "") return { ok: false, reason: "not_found" };
    if (!this.state.members[callerId]) return { ok: false, reason: "not_member" };
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
    if (this.state.groupId === "") return { ok: false, reason: "not_found" };
    if (!this.state.members[callerId]) return { ok: false, reason: "not_member" };
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
    if (this.state.groupId === "") return { ok: false, reason: "not_found" };
    if (!this.state.members[callerId]) return { ok: false, reason: "not_member" };
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
      name: this.state.name,
      displayName: this.state.displayName,
      ownerId: this.state.ownerId,
      sources: this.state.sources ?? [],
      bookTitles: this.state.bookTitles ?? {},
      sourceMeta: this.state.sourceMeta ?? {},
      memberCount: Object.keys(this.state.members).length,
    };
  }

  private async indexFor(email: string): Promise<void> {
    const auth = await getAgentByName(this.env.AuthAgent, email.trim().toLowerCase());
    await auth.addGroup(this.name);
  }
}
