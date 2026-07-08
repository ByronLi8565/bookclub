import { useCallback, useSyncExternalStore } from "react";
import {
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { parseHttpError } from "../http.ts";
import { apiFetch, setSessionToken } from "../logic/net/api.ts";
import { isOnline, subscribeOnline } from "../logic/net/online.ts";
import { readLocal, removeLocal, writeLocal } from "../logic/storage.ts";

const SESSION_CACHE_KEY = "bookclub.session.user";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatarImageId?: string;
}

export type SessionStatus = "loading" | "anon" | "authed";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type StartResult = { ok: true; devSignedIn?: boolean } | { ok: false; error: string };

export interface Session {
  status: SessionStatus;
  user: SessionUser | null;

  startLogin: (email: string) => Promise<StartResult>;

  verify: (email: string, code: string, displayName?: string) => Promise<ActionResult>;
  loginWithPassword: (email: string, password: string) => Promise<ActionResult>;
  passkeyLogin: (email: string) => Promise<ActionResult>;
  signOut: () => Promise<void>;
}

interface SessionSnapshot {
  status: SessionStatus;
  user: SessionUser | null;
}

let sessionSnapshot: SessionSnapshot = { status: "loading", user: null };
let sessionStarted = false;
const sessionListeners = new Set<() => void>();

function setSessionSnapshot(next: SessionSnapshot): void {
  sessionSnapshot = next;
  for (const listener of sessionListeners) listener();
}

function cacheUser(user: SessionUser | null): void {
  if (user) writeLocal(SESSION_CACHE_KEY, user);
  else removeLocal(SESSION_CACHE_KEY);
}

function ensureSessionLoaded(): void {
  if (sessionStarted) return;
  sessionStarted = true;
  revalidateSession();
}

// Network failure falls back to the cached identity; any server response is authoritative.
function revalidateSession(): void {
  void apiFetch("/auth/me")
    .then(async (r) => {
      if (r.ok) {
        const user = ((await r.json()) as { user: SessionUser }).user;
        cacheUser(user);
        setSessionSnapshot({ user, status: "authed" });
        return;
      }
      cacheUser(null);
      setSessionSnapshot({ user: null, status: "anon" });
    })
    .catch(() => {
      const cached = readLocal<SessionUser>(SESSION_CACHE_KEY);
      setSessionSnapshot(
        cached ? { user: cached, status: "authed" } : { user: null, status: "anon" },
      );
    });
}

subscribeOnline(() => {
  if (sessionStarted && isOnline()) revalidateSession();
});

function subscribeSession(listener: () => void): () => void {
  sessionListeners.add(listener);
  ensureSessionLoaded();
  return () => sessionListeners.delete(listener);
}

export function useSession(): Session {
  const { status, user } = useSyncExternalStore(
    subscribeSession,
    () => sessionSnapshot,
    () => sessionSnapshot,
  );

  const startLogin = useCallback(async (email: string): Promise<StartResult> => {
    const r = await apiFetch("/auth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!r.ok) return { ok: false, error: await parseHttpError(r) };

    if (r.status !== 204) {
      const body = (await r.json()) as {
        devSignedIn?: boolean;
        user?: SessionUser;
        token?: string;
      };
      if (body?.devSignedIn && body.user) {
        await setSessionToken(body.token ?? null);
        cacheUser(body.user);
        setSessionSnapshot({ user: body.user, status: "authed" });
        return { ok: true, devSignedIn: true };
      }
    }
    return { ok: true };
  }, []);

  const verify = useCallback(
    async (email: string, code: string, displayName?: string): Promise<ActionResult> => {
      const r = await apiFetch("/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, displayName }),
      });
      if (!r.ok) return { ok: false, error: await parseHttpError(r) };
      const body = (await r.json()) as { user: SessionUser; token?: string };
      await setSessionToken(body.token ?? null);
      cacheUser(body.user);
      setSessionSnapshot({ user: body.user, status: "authed" });
      return { ok: true };
    },
    [],
  );

  const loginWithPassword = useCallback(
    async (email: string, password: string): Promise<ActionResult> => {
      const r = await apiFetch("/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!r.ok) return { ok: false, error: await parseHttpError(r) };
      const body = (await r.json()) as { user: SessionUser; token?: string };
      await setSessionToken(body.token ?? null);
      cacheUser(body.user);
      setSessionSnapshot({ user: body.user, status: "authed" });
      return { ok: true };
    },
    [],
  );

  const passkeyLogin = useCallback(async (email: string): Promise<ActionResult> => {
    const optionsRes = await apiFetch("/auth/passkey/login/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!optionsRes.ok) return { ok: false, error: await parseHttpError(optionsRes) };
    const optionsJSON = (await optionsRes.json()) as PublicKeyCredentialRequestOptionsJSON;

    let assertion;
    try {
      assertion = await startAuthentication({ optionsJSON });
    } catch {
      return { ok: false, error: "passkey_cancelled" };
    }

    const verifyRes = await apiFetch("/auth/passkey/login/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: assertion }),
    });
    if (!verifyRes.ok) return { ok: false, error: await parseHttpError(verifyRes) };
    const body = (await verifyRes.json()) as { user: SessionUser; token?: string };
    await setSessionToken(body.token ?? null);
    cacheUser(body.user);
    setSessionSnapshot({ user: body.user, status: "authed" });
    return { ok: true };
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    await apiFetch("/auth/signout", { method: "POST" });
    await setSessionToken(null);
    cacheUser(null);
    setSessionSnapshot({ user: null, status: "anon" });
  }, []);

  return { status, user, startLogin, verify, loginWithPassword, passkeyLogin, signOut };
}
