import { ulid } from "ulidx";
import type { GroupSummary } from "../../../src/shared/types/groups.ts";
import { groupUrlName } from "../../../src/shared/groupUrls.ts";

// The typed HTTP surface — the same public routes the SPA calls. Everything here
// is black-box `fetch` against the running worker; nothing imports server
// internals. Identity is a real signed session cookie minted via dev-auth
// (`POST /auth/start` auto-signs-in when `DEV_AUTH=true`), so a
// scenario can create as many isolated users as it likes with no mailbox.

export interface Identity {
  readonly user: { id: string; email: string; name: string };
  /** The `bc_session=...` cookie pair, sent on every request this identity makes. */
  readonly cookie: string;
  /** Human label for artifacts / assertions. */
  readonly label: string;
}

export interface ApiSurface {
  /** Mint a fresh, logged-in user. Email is unique per call unless supplied. */
  newIdentity(opts?: { email?: string; label?: string }): Promise<Identity>;
  /** Create a group owned by `who`; returns its summary (incl. internal groupId). */
  createGroup(who: Identity, displayName: string): Promise<GroupSummary>;
  /** Get (or create) the group's open invite token. `ref` is the URL ref. */
  inviteLink(who: Identity, ref: string): Promise<string>;
  /** Redeem an invite token as `who`; returns the group summary. */
  join(who: Identity, ref: string, token: string): Promise<GroupSummary>;
  /** The `slug-publicId` URL ref used by the /groups/:ref routes. */
  refFor(group: GroupSummary): string;
  /** Escape hatch for asserting on routes without a helper (raw Response). */
  request(who: Identity | null, path: string, init?: RequestInit): Promise<Response>;
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export function makeApiSurface(baseUrl: string): ApiSurface {
  const url = (path: string): string => `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const request: ApiSurface["request"] = (who, path, init = {}) => {
    const headers = new Headers(init.headers);
    if (who) headers.set("Cookie", who.cookie);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return fetch(url(path), { ...init, headers });
  };

  async function json<T>(res: Response, context: string): Promise<T> {
    if (!res.ok) {
      const body = await res.text();
      throw new ApiError(`${context} failed: ${res.status} ${body}`, res.status, body);
    }
    return (await res.json()) as T;
  }

  return {
    request,

    async newIdentity(opts = {}) {
      const email = opts.email ?? `e2e-${ulid().toLowerCase()}@example.com`;
      const res = await request(null, "/auth/start", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      const setCookie = res.headers.getSetCookie?.() ?? [];
      const raw = setCookie[0] ?? res.headers.get("set-cookie");
      if (!res.ok || !raw) {
        const body = await res.text();
        throw new ApiError(
          `newIdentity failed: ${res.status} ${body} — is DEV_AUTH=true?`,
          res.status,
          body,
        );
      }
      const { user } = (await res.json()) as { user: Identity["user"] };
      return { user, cookie: raw.split(";")[0]!, label: opts.label ?? user.name };
    },

    async createGroup(who, displayName) {
      const res = await request(who, "/groups", {
        method: "POST",
        body: JSON.stringify({ displayName }),
      });
      const { group } = await json<{ group: GroupSummary }>(res, "createGroup");
      return group;
    },

    async inviteLink(who, ref) {
      const res = await request(who, `/groups/${ref}/invite-link`, { method: "POST" });
      const { token } = await json<{ token: string }>(res, "inviteLink");
      return token;
    },

    async join(who, ref, token) {
      const res = await request(who, `/groups/${ref}/join`, {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      const { group } = await json<{ group: GroupSummary }>(res, "join");
      return group;
    },

    refFor(group) {
      return groupUrlName(group);
    },
  };
}
