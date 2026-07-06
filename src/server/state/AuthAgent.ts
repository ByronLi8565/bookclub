import { Agent } from "agents";
import { monotonicFactory } from "ulidx";
import { constantTimeEqual, sha256Hex } from "../../shared/crypto.ts";
import type { StoredReadingPosition } from "../../shared/types/readingPositions.ts";
import type { PasskeyInfo } from "../../shared/types/passkeys.ts";
import { mergeUserPrefs, type UserPrefs } from "../../shared/types/userPrefs.ts";
import type { Env } from "../env.ts";
import { hashPassword, verifyPassword, type PasswordHash } from "../auth/password.ts";
import type { StoredCredential } from "../auth/webauthn.ts";
import { sendLoginCode } from "../services/email.ts";

const ulid = monotonicFactory();
const encoder = new TextEncoder();

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  groupIds: string[];
}

function positionKey(groupId: string, sourceId: string): string {
  return `${groupId}:${sourceId}`;
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
  password?: PasswordHash | null;
  credentials?: StoredCredential[];
  regChallenge?: RegChallenge | null;
  pwRate?: RateWindow | null;
}

export type VerifyResult =
  | { ok: true; user: User }
  | { ok: false; reason: "no_pending" | "expired" | "too_many_attempts" | "bad_code" };

export type PasswordLoginResult =
  | { ok: true; user: User }
  | { ok: false; reason: "no_password" | "rate_limited" | "bad_password" };

export type SetPasswordResult = { ok: true } | { ok: false; reason: "no_user" | "bad_current" };

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 5;
const MAX_PW_ATTEMPTS_PER_WINDOW = 10;
const REG_CHALLENGE_TTL_MS = 5 * 60 * 1000;

function hashCode(email: string, code: string): Promise<string> {
  return sha256Hex(encoder.encode(`${email}:${code}`).buffer);
}

function generateCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return n.toString().padStart(6, "0");
}

export class AuthAgent extends Agent<Env, AuthState> {
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
    if (!pending) return { ok: false, reason: "no_pending" };
    if (Date.now() > pending.expiresAt) {
      this.setState({ ...this.state, pending: null });
      return { ok: false, reason: "expired" };
    }
    if (pending.attempts >= MAX_ATTEMPTS) {
      this.setState({ ...this.state, pending: null });
      return { ok: false, reason: "too_many_attempts" };
    }

    const hash = await hashCode(email, code);
    if (!constantTimeEqual(hash, pending.hash)) {
      this.setState({ ...this.state, pending: { ...pending, attempts: pending.attempts + 1 } });
      return { ok: false, reason: "bad_code" };
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

  // --- Password ---

  hasPassword(): boolean {
    return Boolean(this.state.password);
  }

  // Login with a set password. Rate-limited per DO (i.e. per email) so a set
  // password can't be brute-forced. A missing password is reported distinctly
  // so callers can fall back to the email-code flow rather than treating it as
  // a wrong password.
  async loginWithPassword(email: string, password: string): Promise<PasswordLoginResult> {
    const stored = this.state.password;
    if (!stored) return { ok: false, reason: "no_password" };

    const now = Date.now();
    const rate =
      this.state.pwRate && now - this.state.pwRate.windowStart < RATE_WINDOW_MS
        ? this.state.pwRate
        : { windowStart: now, sends: 0 };
    if (rate.sends >= MAX_PW_ATTEMPTS_PER_WINDOW) return { ok: false, reason: "rate_limited" };
    this.setState({
      ...this.state,
      pwRate: { windowStart: rate.windowStart, sends: rate.sends + 1 },
    });

    if (!(await verifyPassword(password, stored))) return { ok: false, reason: "bad_password" };

    const user = this.upsertUser(email);
    this.setState({ ...this.state, user, pwRate: null });
    return { ok: true, user };
  }

  // Set or change the password for an existing user. When a password is already
  // set, the caller must prove knowledge of the current one.
  async setPassword(next: string, current?: string): Promise<SetPasswordResult> {
    if (!this.state.user) return { ok: false, reason: "no_user" };
    if (
      this.state.password &&
      (!current || !(await verifyPassword(current, this.state.password)))
    ) {
      return { ok: false, reason: "bad_current" };
    }
    this.setState({ ...this.state, password: await hashPassword(next), pwRate: null });
    return { ok: true };
  }

  async removePassword(current: string): Promise<SetPasswordResult> {
    if (!this.state.user) return { ok: false, reason: "no_user" };
    if (this.state.password && !(await verifyPassword(current, this.state.password))) {
      return { ok: false, reason: "bad_current" };
    }
    this.setState({ ...this.state, password: null });
    return { ok: true };
  }

  // --- Passkeys ---

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

  // Stash the registration challenge between the options and verify round-trips.
  // Registration always happens within an authenticated session, so the email
  // key is known and the challenge can live in this DO (short-lived).
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

  // Links a group to this user. Self-heals a missing user record from the
  // caller's identity: auth is cookie-based (a signed session, independent of
  // this DO), so a valid caller can exist before/without a stored user record
  // (e.g. after the DO's state was reset). `identity` is required so this can
  // never silently no-op when there's no stored user — the original bug where a
  // club got created but never indexed into the owner's account. Idempotent:
  // re-linking an already-linked group is a no-op.
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
