import { useCallback, useSyncExternalStore } from "react";
import { parseHttpError } from "../http.ts";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export type SessionStatus = "loading" | "anon" | "authed";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type StartResult = { ok: true; devSignedIn?: boolean } | { ok: false; error: string };

export interface Session {
  status: SessionStatus;
  user: SessionUser | null;

  startLogin: (email: string) => Promise<StartResult>;

  verify: (email: string, code: string, displayName?: string) => Promise<ActionResult>;
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

function ensureSessionLoaded(): void {
  if (sessionStarted) return;
  sessionStarted = true;
  void fetch("/auth/me")
    .then(async (r) => (r.ok ? ((await r.json()) as { user: SessionUser }).user : null))
    .catch(() => null)
    .then((user) => setSessionSnapshot({ user, status: user ? "authed" : "anon" }));
}

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
    const r = await fetch("/auth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!r.ok) return { ok: false, error: await parseHttpError(r) };

    if (r.status !== 204) {
      const body = (await r.json().catch(() => null)) as {
        devSignedIn?: boolean;
        user?: SessionUser;
      } | null;
      if (body?.devSignedIn && body.user) {
        setSessionSnapshot({ user: body.user, status: "authed" });
        return { ok: true, devSignedIn: true };
      }
    }
    return { ok: true };
  }, []);

  const verify = useCallback(
    async (email: string, code: string, displayName?: string): Promise<ActionResult> => {
      const r = await fetch("/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, displayName }),
      });
      if (!r.ok) return { ok: false, error: await parseHttpError(r) };
      const body = (await r.json()) as { user: SessionUser };
      setSessionSnapshot({ user: body.user, status: "authed" });
      return { ok: true };
    },
    [],
  );

  const signOut = useCallback(async (): Promise<void> => {
    await fetch("/auth/signout", { method: "POST" }).catch(() => {});
    setSessionSnapshot({ user: null, status: "anon" });
  }, []);

  return { status, user, startLogin, verify, signOut };
}
