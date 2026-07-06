import type { PasskeyInfo } from "../../../src/shared/types/passkeys.ts";
import type { Identity } from "./api.ts";
import { SoftwareAuthenticator } from "./webauthn-authenticator.ts";

// The auth surface: the passwordless-and-more sign-in paths a real client uses,
// driven purely over HTTP. Password login is plain JSON; passkey login is a full
// WebAuthn ceremony carried out by an in-process SoftwareAuthenticator that
// stands in for a browser + platform authenticator. Nothing here imports server
// internals — it only speaks the public /auth and /me routes.

export interface AuthSurface {
  /** Set (or change) a password for an already-signed-in identity. */
  setPassword(who: Identity, password: string, current?: string): Promise<Response>;
  /** Sign in with email + password from a clean client; returns a fresh identity. */
  loginWithPassword(email: string, password: string): Promise<Identity>;
  /** Raw password-login response, for asserting on rejection paths. */
  attemptPassword(email: string, password: string): Promise<Response>;

  /** Register a passkey for a signed-in identity; returns the authenticator to reuse. */
  registerPasskey(who: Identity, label?: string): Promise<SoftwareAuthenticator>;
  /** Authenticate with a previously-registered authenticator; returns a fresh identity. */
  loginWithPasskey(email: string, authenticator: SoftwareAuthenticator): Promise<Identity>;
  /** List the signed-in identity's registered passkeys. */
  listPasskeys(who: Identity): Promise<PasskeyInfo[]>;
}

class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

export function makeAuthSurface(baseUrl: string): AuthSurface {
  const origin = new URL(baseUrl).origin;
  const url = (path: string): string => `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  function send(
    method: string,
    who: Identity | null,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (who) headers.set("Cookie", who.cookie);
    return fetch(url(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  const post = (who: Identity | null, path: string, body?: unknown): Promise<Response> =>
    send("POST", who, path, body);

  function sessionCookie(res: Response): string | null {
    const cookies = res.headers.getSetCookie?.() ?? [];
    const all = cookies.length > 0 ? cookies : [res.headers.get("set-cookie") ?? ""];
    for (const raw of all) {
      if (raw.startsWith("bc_session=")) return raw.split(";")[0]!;
    }
    return null;
  }

  async function identityFrom(res: Response, context: string): Promise<Identity> {
    if (!res.ok) {
      const body = await res.text();
      throw new AuthError(`${context} failed: ${res.status} ${body}`, res.status, body);
    }
    const cookie = sessionCookie(res);
    if (!cookie) throw new AuthError(`${context}: no session cookie set`, res.status, "");
    const { user } = (await res.json()) as { user: Identity["user"] };
    return { user, cookie, label: user.name };
  }

  return {
    setPassword(who, password, current) {
      return send("PUT", who, "/me/password", { password, currentPassword: current });
    },

    attemptPassword(email, password) {
      return post(null, "/auth/password", { email, password });
    },

    async loginWithPassword(email, password) {
      const res = await post(null, "/auth/password", { email, password });
      return identityFrom(res, "loginWithPassword");
    },

    async registerPasskey(who, label = "e2e passkey") {
      const authenticator = await SoftwareAuthenticator.create();
      const optionsRes = await post(who, "/auth/passkey/register/options");
      if (!optionsRes.ok) {
        throw new AuthError("register options failed", optionsRes.status, await optionsRes.text());
      }
      const options = (await optionsRes.json()) as { challenge: string; rp: { id: string } };
      const attestation = await authenticator.attest(options, origin);
      const verifyRes = await post(who, "/auth/passkey/register/verify", {
        response: attestation,
        label,
      });
      if (!verifyRes.ok) {
        throw new AuthError("register verify failed", verifyRes.status, await verifyRes.text());
      }
      return authenticator;
    },

    async loginWithPasskey(email, authenticator) {
      const optionsRes = await post(null, "/auth/passkey/login/options", { email });
      if (!optionsRes.ok) {
        throw new AuthError("login options failed", optionsRes.status, await optionsRes.text());
      }
      const options = (await optionsRes.json()) as { challenge: string; rpId: string };
      // The login options request set the signed challenge cookie; carry it into
      // the verify request exactly as a browser would.
      const challengeCookie = (optionsRes.headers.getSetCookie?.() ?? [])
        .find((c) => c.startsWith("bc_pk_challenge="))
        ?.split(";")[0];
      const assertion = await authenticator.assert(options, origin);
      const headers = new Headers({ "Content-Type": "application/json" });
      if (challengeCookie) headers.set("Cookie", challengeCookie);
      const verifyRes = await fetch(url("/auth/passkey/login/verify"), {
        method: "POST",
        headers,
        body: JSON.stringify({ response: assertion }),
      });
      return identityFrom(verifyRes, "loginWithPasskey");
    },

    async listPasskeys(who) {
      const res = await fetch(url("/me/passkeys"), { headers: { Cookie: who.cookie } });
      if (!res.ok) throw new AuthError("listPasskeys failed", res.status, await res.text());
      const { passkeys } = (await res.json()) as { passkeys: PasskeyInfo[] };
      return passkeys;
    },
  };
}
