import { Agent } from "agents";
import { monotonicFactory } from "ulidx";
import type { Env } from "./env.ts";
import { sendLoginCode } from "./email.ts";

const ulid = monotonicFactory();

// A registered person. `groupIds` is the user -> groups reverse index that
// powers the home group list (populated in Phase B on create/redeem).
export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  groupIds: string[];
}

// The in-flight login code for this email. Stored hashed; never the plaintext.
interface PendingCode {
  hash: string;
  expiresAt: number;
  attempts: number;
}

// Per-email send rate limiting (a sliding-ish fixed window).
interface RateWindow {
  windowStart: number;
  sends: number;
}

export interface AuthState {
  user: User | null;
  pending: PendingCode | null;
  rate: RateWindow | null;
}

export type VerifyResult =
  | { ok: true; user: User }
  | { ok: false; reason: "no_pending" | "expired" | "too_many_attempts" | "bad_code" };

// Tunables. Codes are short-lived, single-use, attempt-capped, and send-capped.
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 5;

const encoder = new TextEncoder();

// Hash a code salted by the email so identical codes for different emails (and
// the stored value itself) are not interchangeable.
async function hashCode(email: string, code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${email}:${code}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a.codePointAt(i) ?? 0) ^ (b.codePointAt(i) ?? 0);
  return diff === 0;
}

// A 6-digit numeric code from a uniform source (rejection-free modulo bias is
// negligible at this range; "user enumeration is not a vuln" per decision 1).
function generateCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return n.toString().padStart(6, "0");
}

// One instance per normalized email. Owns the User record and the email-code
// login flow (issuance, rate limiting, verification). Methods are invoked by the
// worker's /auth routes over a DO stub. The server is the authority: no client
// ever writes this state directly.
export class AuthAgent extends Agent<Env, AuthState> {
  initialState: AuthState = { user: null, pending: null, rate: null };

  // Mint a login code for `email`, store its hash, and deliver it. Rate-limited
  // per email. Returns whether a code was sent (false = rate limited).
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

  // Check a submitted code. On success, upsert the user (creating it on first
  // sign-in) and clear the pending code. Single-use and attempt-capped.
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

  // The current user record, if any.
  getUser(): User | null {
    return this.state.user;
  }

  // Append a group to this user's reverse index (called by GroupAgent on create
  // and invite-redeem). Idempotent; no-op if the user record doesn't exist yet.
  addGroup(groupId: string): void {
    const user = this.state.user;
    if (!user || user.groupIds.includes(groupId)) return;
    this.setState({ ...this.state, user: { ...user, groupIds: [...user.groupIds, groupId] } });
  }

  // The groups this user belongs to (powers the home list).
  getGroupIds(): string[] {
    return this.state.user?.groupIds ?? [];
  }

  private upsertUser(email: string, displayName?: string): User {
    const existing = this.state.user;
    if (existing) {
      // Adopt a newly-supplied display name; otherwise keep the stored one.
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
