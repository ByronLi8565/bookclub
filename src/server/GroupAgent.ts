import { Agent, getAgentByName } from "agents";
import type { Env } from "./env.ts";
import { REGISTRY_ID } from "./GroupRegistry.ts";
import type { NormalizedName } from "./names.ts";

export type GroupRole = "owner" | "member";

// A person in the group: their role plus a snapshot of identity for display.
export interface Member {
  role: GroupRole;
  name: string;
  email: string;
  joinedAt: string;
}

// A pending invite, keyed by its opaque token and bound to one email address so
// the link can only be redeemed by the intended invitee (decision 5).
interface Invite {
  email: string;
  createdAt: number;
}

export interface GroupState {
  // Empty until `create` runs; non-empty groupId marks an initialized group.
  groupId: string;
  name: string; // normalized key (matches the registry)
  displayName: string;
  ownerId: string;
  members: Record<string, Member>; // by userId
  sources: string[]; // book content hashes bound to this group
  invites: Record<string, Invite>; // by token
  createdAt: string;
}

// The public, non-sensitive view of a group (no invite tokens).
export interface GroupSummary {
  groupId: string;
  name: string;
  displayName: string;
  ownerId: string;
  sources: string[];
  memberCount: number;
}

// Identity of a caller, already validated from the session by the worker. The
// GroupAgent trusts its caller (the worker), never a raw client.
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
  | { ok: false; reason: "not_owner" | "not_found" };
export type RedeemResult =
  | { ok: true; summary: GroupSummary }
  | { ok: false; reason: "not_found" | "bad_invite" | "wrong_email" };
export type AddSourceResult =
  | { ok: true; summary: GroupSummary }
  | { ok: false; reason: "not_owner" | "not_found" };

function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// One instance per groupId (decision 6). Source of truth for membership, roles,
// bound book sources, and pending invites. Lifecycle methods are invoked by the
// worker over a DO stub after it has validated the caller's session.
export class GroupAgent extends Agent<Env, GroupState> {
  initialState: GroupState = {
    groupId: "",
    name: "",
    displayName: "",
    ownerId: "",
    members: {},
    sources: [],
    invites: {},
    createdAt: "",
  };

  // Initialize a new group: reserve its name globally, set the caller as owner,
  // and add it to the owner's group index. The groupId is this agent's name.
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
      invites: {},
      createdAt: now,
    });
    await this.indexFor(owner.email);
    return { ok: true, summary: this.summary() };
  }

  // Owner-only: mint an invite token bound to `email`. The worker turns the
  // token into a link and emails it. Returns the token (idempotent per email).
  invite(callerId: string, email: string): InviteResult {
    if (this.state.groupId === "") return { ok: false, reason: "not_found" };
    if (callerId !== this.state.ownerId) return { ok: false, reason: "not_owner" };

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

  // Redeem an invite: the caller (signed in) joins as a member. The invite is
  // single-use and must match the caller's email.
  async redeem(t: string, user: Identity): Promise<RedeemResult> {
    if (this.state.groupId === "") return { ok: false, reason: "not_found" };
    if (this.state.members[user.id]) return { ok: true, summary: this.summary() };

    const invite = this.state.invites[t];
    if (!invite) return { ok: false, reason: "bad_invite" };
    if (invite.email !== user.email.trim().toLowerCase())
      return { ok: false, reason: "wrong_email" };

    const now = new Date().toISOString();
    const { [t]: _used, ...rest } = this.state.invites;
    this.setState({
      ...this.state,
      members: {
        ...this.state.members,
        [user.id]: { role: "member", name: user.name, email: user.email, joinedAt: now },
      },
      invites: rest,
    });
    await this.indexFor(user.email);
    return { ok: true, summary: this.summary() };
  }

  // Owner-only: bind a book content hash to this group (decision 13, owner-only
  // upload). Idempotent.
  addSource(callerId: string, sourceId: string): AddSourceResult {
    if (this.state.groupId === "") return { ok: false, reason: "not_found" };
    if (callerId !== this.state.ownerId) return { ok: false, reason: "not_owner" };
    if (!this.state.sources.includes(sourceId)) {
      this.setState({ ...this.state, sources: [...this.state.sources, sourceId] });
    }
    return { ok: true, summary: this.summary() };
  }

  // Membership/role lookup for the connect gate and routing.
  membership(userId: string): { isMember: boolean; role: GroupRole | null } {
    const member = this.state.members[userId];
    return member ? { isMember: true, role: member.role } : { isMember: false, role: null };
  }

  // The public group view; null if this group was never created.
  getSummary(): GroupSummary | null {
    return this.state.groupId === "" ? null : this.summary();
  }

  private summary(): GroupSummary {
    return {
      groupId: this.state.groupId,
      name: this.state.name,
      displayName: this.state.displayName,
      ownerId: this.state.ownerId,
      sources: this.state.sources,
      memberCount: Object.keys(this.state.members).length,
    };
  }

  // Append this group to a member's user -> groups reverse index (AuthAgent).
  private async indexFor(email: string): Promise<void> {
    const auth = await getAgentByName(this.env.AuthAgent, email.trim().toLowerCase());
    await auth.addGroup(this.name);
  }
}
