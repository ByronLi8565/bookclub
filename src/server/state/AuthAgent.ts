import { getAgentByName } from "agents";
import { ServerOwnedAgent } from "./serverOwnedAgent.ts";
import { monotonicFactory } from "ulidx";
import { constantTimeEqual, sha256Hex } from "../../shared/crypto.ts";
import type { StoredReadingPosition } from "../../shared/types/readingPositions.ts";
import type { BookmarkColor, StoredBookmark } from "../../shared/types/bookmarks.ts";
import type { PasskeyInfo } from "../../shared/types/passkeys.ts";
import { mergeUserPrefs, type UserPrefs } from "../../shared/types/userPrefs.ts";
import type { Env } from "../env.ts";
import { hashPassword, verifyPassword, type PasswordHash } from "../auth/password.ts";
import type { StoredCredential } from "../auth/webauthn.ts";
import { sendLoginCode } from "../services/email.ts";
import { avatarScope, deleteImages } from "../services/images.ts";

const ulid = monotonicFactory();
const encoder = new TextEncoder();

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarImageId?: string;
  createdAt: string;
  groupIds: string[];
  clubDisplayNames?: Record<string, string>;
}

function positionKey(groupId: string, sourceId: string): string {
  return `${groupId}:${sourceId}`;
}

function bookmarkKey(groupId: string, sourceId: string, color: BookmarkColor): string {
  return `${groupId}:${sourceId}:${color}`;
}

interface PendingCode {
  hash: string;
  expiresAt: number;
  attempts: number;
}

interface RateWindow {
  windowStart: number;
  sends: number;
}

interface RegChallenge {
  challenge: string;
  expiresAt: number;
}

export interface AuthState {
  user: User | null;
  pending: PendingCode | null;
  rate: RateWindow | null;
  prefs?: UserPrefs;
  readingPositions?: Record<string, StoredReadingPosition>;
  bookmarks?: Record<string, StoredBookmark>;
  password?: PasswordHash | null;
  credentials?: StoredCredential[];
  regChallenge?: RegChallenge | null;
  pwRate?: RateWindow | null;
  /** Replaced avatar ids and when they were replaced, kept until the grace period ends. */
  retiredAvatars?: Record<string, number>;
  /** Passkey login challenges already accepted, until each one's signed expiry. */
  usedLoginChallenges?: Record<string, number>;
}

export const AuthFailureReason = {
  NoPending: "no_pending",
  Expired: "expired",
  TooManyAttempts: "too_many_attempts",
  BadCode: "bad_code",
  NoPassword: "no_password",
  RateLimited: "rate_limited",
  BadPassword: "bad_password",
  NoUser: "no_user",
  BadCurrent: "bad_current",
} as const;

export type AuthFailureReason = (typeof AuthFailureReason)[keyof typeof AuthFailureReason];

type AuthFailure<R extends AuthFailureReason> = { ok: false; reason: R };

export type VerifyResult =
  | { ok: true; user: User }
  | AuthFailure<
      | typeof AuthFailureReason.NoPending
      | typeof AuthFailureReason.Expired
      | typeof AuthFailureReason.TooManyAttempts
      | typeof AuthFailureReason.BadCode
    >;

export type PasswordLoginResult =
  | { ok: true; user: User }
  | AuthFailure<
      | typeof AuthFailureReason.NoPassword
      | typeof AuthFailureReason.RateLimited
      | typeof AuthFailureReason.BadPassword
    >;

export type SetPasswordResult =
  | { ok: true }
  | AuthFailure<
      | typeof AuthFailureReason.NoUser
      | typeof AuthFailureReason.BadCurrent
      | typeof AuthFailureReason.RateLimited
    >;

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 5;
const MAX_PW_ATTEMPTS_PER_WINDOW = 10;
const REG_CHALLENGE_TTL_MS = 5 * 60 * 1000;
// Groups may still show a replaced avatar until their projection converges.
const AVATAR_GRACE_SECONDS = 7 * 24 * 60 * 60;

function hashCode(email: string, code: string): Promise<string> {
  return sha256Hex(encoder.encode(`${email}:${code}`).buffer);
}

function generateCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return n.toString().padStart(6, "0");
}

export class AuthAgent extends ServerOwnedAgent<Env, AuthState> {
  initialState: AuthState = {
    user: null,
    pending: null,
    rate: null,
    password: null,
    credentials: [],
    regChallenge: null,
    pwRate: null,
  };

  async startLogin(email: string): Promise<boolean> {
    const now = Date.now();
    const rate =
      this.state.rate && now - this.state.rate.windowStart < RATE_WINDOW_MS
        ? this.state.rate
        : { windowStart: now, sends: 0 };
    if (rate.sends >= MAX_SENDS_PER_WINDOW) return false;

    const code = generateCode();
    const hash = await hashCode(email, code);
    this.setState({
      ...this.state,
      pending: { hash, expiresAt: now + CODE_TTL_MS, attempts: 0 },
      rate: { windowStart: rate.windowStart, sends: rate.sends + 1 },
    });
    await sendLoginCode(this.env, email, code);
    return true;
  }

  async verifyLogin(email: string, code: string, displayName?: string): Promise<VerifyResult> {
    const pending = this.state.pending;
    if (!pending) return { ok: false, reason: AuthFailureReason.NoPending };
    if (Date.now() > pending.expiresAt) {
      this.setState({ ...this.state, pending: null });
      return { ok: false, reason: AuthFailureReason.Expired };
    }
    if (pending.attempts >= MAX_ATTEMPTS) {
      this.setState({ ...this.state, pending: null });
      return { ok: false, reason: AuthFailureReason.TooManyAttempts };
    }

    const hash = await hashCode(email, code);
    if (!constantTimeEqual(hash, pending.hash)) {
      this.setState({ ...this.state, pending: { ...pending, attempts: pending.attempts + 1 } });
      return { ok: false, reason: AuthFailureReason.BadCode };
    }

    const user = this.upsertUser(email, displayName);
    this.setState({ ...this.state, user, pending: null });
    return { ok: true, user };
  }

  devLogin(email: string, displayName?: string): User {
    const user = this.upsertUser(email, displayName);
    this.setState({ ...this.state, user, pending: null });
    return user;
  }

  getUser(): User | null {
    return this.state.user;
  }

  /** Commits the new avatar, then projects it into every Group. The replaced
   *  file outlives the swap by a grace period so stale projections still resolve. */
  async setAvatarImageId(imageId: string): Promise<User | null> {
    const current = this.state.user;
    if (!current) return null;
    const user = { ...current, avatarImageId: imageId };
    const retiring = current.avatarImageId === imageId ? undefined : current.avatarImageId;
    if (retiring) {
      this.setState({
        ...this.state,
        user,
        retiredAvatars: { ...this.state.retiredAvatars, [retiring]: Date.now() },
      });
      await this.schedule(AVATAR_GRACE_SECONDS, "purgeRetiredAvatars");
    } else {
      this.setState({ ...this.state, user });
    }
    await this.projectProfile(user.groupIds);
    return user;
  }

  async purgeRetiredAvatars(): Promise<void> {
    const user = this.state.user;
    const cutoff = Date.now() - AVATAR_GRACE_SECONDS * 1000;
    const due = Object.entries(this.state.retiredAvatars ?? {}).flatMap(([id, retiredAt]) =>
      retiredAt <= cutoff ? [id] : [],
    );
    if (!user || due.length === 0) return;
    await this.reconcile("purgeRetiredAvatars", undefined, async () => {
      await deleteImages(this.env, avatarScope(user.id), due);
      const purged = new Set(due);
      this.setState({
        ...this.state,
        retiredAvatars: Object.fromEntries(
          Object.entries(this.state.retiredAvatars ?? {}).filter(([id]) => !purged.has(id)),
        ),
      });
    });
  }

  getClubProfile(groupId: string): { displayName: string; avatarImageId?: string } | null {
    const user = this.state.user;
    if (!user) return null;
    const displayName = user.clubDisplayNames?.[groupId] ?? user.displayName;
    return user.avatarImageId
      ? { displayName, avatarImageId: user.avatarImageId }
      : { displayName };
  }

  async setClubDisplayName(groupId: string, displayName: string): Promise<User | null> {
    const user = this.state.user;
    if (!user) return null;
    const next = {
      ...user,
      clubDisplayNames: { ...user.clubDisplayNames, [groupId]: displayName },
    };
    this.setState({ ...this.state, user: next });
    await this.projectProfile([groupId]);
    return next;
  }

  /** Carries this account's current per-Group name and avatar into each Group's roster. */
  async projectProfile(groupIds: string[]): Promise<void> {
    await this.reconcile("projectProfile", groupIds, async () => {
      await Promise.all(
        groupIds.map(async (groupId) => {
          const profile = this.getClubProfile(groupId);
          const userId = this.state.user?.id;
          if (!profile || !userId) return;
          const group = await getAgentByName(this.env.GroupAgent, groupId);
          await group.setMemberProfile(userId, profile.displayName, profile.avatarImageId);
        }),
      );
    });
  }

  hasPassword(): boolean {
    return Boolean(this.state.password);
  }

  // Every password guess, at sign-in or when changing it, draws on one window,
  // so a stolen session cannot brute-force the current password either.
  private async checkPassword(
    candidate: string,
    stored: PasswordHash,
  ): Promise<"ok" | typeof AuthFailureReason.RateLimited | "wrong"> {
    const now = Date.now();
    const rate =
      this.state.pwRate && now - this.state.pwRate.windowStart < RATE_WINDOW_MS
        ? this.state.pwRate
        : { windowStart: now, sends: 0 };
    if (rate.sends >= MAX_PW_ATTEMPTS_PER_WINDOW) return AuthFailureReason.RateLimited;
    this.setState({
      ...this.state,
      pwRate: { windowStart: rate.windowStart, sends: rate.sends + 1 },
    });
    if (!(await verifyPassword(candidate, stored))) return "wrong";
    this.setState({ ...this.state, pwRate: null });
    return "ok";
  }

  async loginWithPassword(email: string, password: string): Promise<PasswordLoginResult> {
    const stored = this.state.password;
    if (!stored) return { ok: false, reason: AuthFailureReason.NoPassword };
    const checked = await this.checkPassword(password, stored);
    if (checked === AuthFailureReason.RateLimited) return { ok: false, reason: checked };
    if (checked === "wrong") return { ok: false, reason: AuthFailureReason.BadPassword };
    const user = this.upsertUser(email);
    this.setState({ ...this.state, user });
    return { ok: true, user };
  }

  // An account without a password needs no current one to set the first.
  private async checkCurrentPassword(current: string | undefined): Promise<SetPasswordResult> {
    if (!this.state.user) return { ok: false, reason: AuthFailureReason.NoUser };
    const stored = this.state.password;
    if (!stored) return { ok: true };
    if (!current) return { ok: false, reason: AuthFailureReason.BadCurrent };
    const checked = await this.checkPassword(current, stored);
    if (checked === AuthFailureReason.RateLimited) return { ok: false, reason: checked };
    return checked === "ok" ? { ok: true } : { ok: false, reason: AuthFailureReason.BadCurrent };
  }

  async setPassword(next: string, current?: string): Promise<SetPasswordResult> {
    const checked = await this.checkCurrentPassword(current);
    if (!checked.ok) return checked;
    this.setState({ ...this.state, password: await hashPassword(next), pwRate: null });
    return { ok: true };
  }

  async removePassword(current: string): Promise<SetPasswordResult> {
    const checked = await this.checkCurrentPassword(current);
    if (!checked.ok) return checked;
    this.setState({ ...this.state, password: null });
    return { ok: true };
  }

  listCredentials(): StoredCredential[] {
    return this.state.credentials ?? [];
  }

  listPasskeys(): PasskeyInfo[] {
    return (this.state.credentials ?? []).map((c) => ({
      id: c.id,
      label: c.label,
      createdAt: c.createdAt,
    }));
  }

  getCredentialById(id: string): StoredCredential | null {
    return (this.state.credentials ?? []).find((c) => c.id === id) ?? null;
  }

  startRegistration(challenge: string): void {
    this.setState({
      ...this.state,
      regChallenge: { challenge, expiresAt: Date.now() + REG_CHALLENGE_TTL_MS },
    });
  }

  takeRegistrationChallenge(): string | null {
    const pending = this.state.regChallenge;
    this.setState({ ...this.state, regChallenge: null });
    if (!pending || Date.now() > pending.expiresAt) return null;
    return pending.challenge;
  }

  /** Accepts a signed login challenge once; a replay before its expiry is refused. */
  consumeLoginChallenge(challenge: string, expiresAt: number): boolean {
    const now = Date.now();
    const live = Object.fromEntries(
      Object.entries(this.state.usedLoginChallenges ?? {}).filter(([, exp]) => exp >= now),
    );
    if (Object.hasOwn(live, challenge)) return false;
    this.setState({ ...this.state, usedLoginChallenges: { ...live, [challenge]: expiresAt } });
    return true;
  }

  addCredential(credential: StoredCredential): void {
    const existing = (this.state.credentials ?? []).filter((c) => c.id !== credential.id);
    this.setState({ ...this.state, credentials: [...existing, credential] });
  }

  bumpCounter(id: string, counter: number): void {
    this.setState({
      ...this.state,
      credentials: (this.state.credentials ?? []).map((c) => (c.id === id ? { ...c, counter } : c)),
    });
  }

  removeCredential(id: string): boolean {
    const before = this.state.credentials ?? [];
    const after = before.filter((c) => c.id !== id);
    if (after.length === before.length) return false;
    this.setState({ ...this.state, credentials: after });
    return true;
  }

  getPrefs(): UserPrefs {
    return mergeUserPrefs(this.state.prefs);
  }

  setPrefs(prefs: UserPrefs): UserPrefs {
    const merged = mergeUserPrefs(prefs);
    this.setState({ ...this.state, prefs: merged });
    return merged;
  }

  getReadingPosition(groupId: string, sourceId: string): StoredReadingPosition | null {
    return this.state.readingPositions?.[positionKey(groupId, sourceId)] ?? null;
  }

  setReadingPosition(position: StoredReadingPosition): StoredReadingPosition {
    const key = positionKey(position.groupId, position.sourceId);
    const existing = this.state.readingPositions?.[key];
    if (existing && Date.parse(existing.updatedAt) > Date.parse(position.updatedAt)) {
      return existing;
    }
    this.setState({
      ...this.state,
      readingPositions: { ...this.state.readingPositions, [key]: position },
    });
    return position;
  }

  getBookmarks(groupId: string, sourceId: string): StoredBookmark[] {
    const prefix = `${groupId}:${sourceId}:`;
    return Object.entries(this.state.bookmarks ?? {})
      .filter(([key]) => key.startsWith(prefix))
      .map(([, bookmark]) => bookmark);
  }

  setBookmark(bookmark: StoredBookmark): StoredBookmark[] {
    const key = bookmarkKey(bookmark.groupId, bookmark.sourceId, bookmark.color);
    const existing = this.state.bookmarks?.[key];
    if (!existing || Date.parse(existing.updatedAt) <= Date.parse(bookmark.updatedAt)) {
      this.setState({ ...this.state, bookmarks: { ...this.state.bookmarks, [key]: bookmark } });
    }
    return this.getBookmarks(bookmark.groupId, bookmark.sourceId);
  }

  // Self-heals a missing user record from the caller's signed-session identity.
  addGroup(groupId: string, identity: { id: string; email: string; name: string }): void {
    const user = this.state.user ?? {
      id: identity.id,
      email: identity.email,
      displayName: identity.name,
      createdAt: new Date().toISOString(),
      groupIds: [],
    };
    if (user.groupIds.includes(groupId)) return;
    this.setState({ ...this.state, user: { ...user, groupIds: [...user.groupIds, groupId] } });
  }

  removeGroup(groupId: string): void {
    const user = this.state.user;
    if (!user || !user.groupIds.includes(groupId)) return;
    const prefix = `${groupId}:`;
    const { [groupId]: _removedName, ...clubDisplayNames } = user.clubDisplayNames ?? {};
    this.setState({
      ...this.state,
      user: { ...user, groupIds: user.groupIds.filter((id) => id !== groupId), clubDisplayNames },
      readingPositions: Object.fromEntries(
        Object.entries(this.state.readingPositions ?? {}).filter(
          ([key]) => !key.startsWith(prefix),
        ),
      ),
      bookmarks: Object.fromEntries(
        Object.entries(this.state.bookmarks ?? {}).filter(([key]) => !key.startsWith(prefix)),
      ),
    });
  }

  getGroupIds(): string[] {
    return this.state.user?.groupIds ?? [];
  }

  exportState(): AuthState {
    return this.state;
  }

  importState(state: AuthState): void {
    this.setState(state);
  }

  private upsertUser(email: string, displayName?: string): User {
    const existing = this.state.user;
    if (existing) {
      return displayName && displayName !== existing.displayName
        ? { ...existing, displayName }
        : existing;
    }
    return {
      id: ulid(),
      email,
      displayName: displayName?.trim() || email.split("@")[0],
      createdAt: new Date().toISOString(),
      groupIds: [],
    };
  }
}
