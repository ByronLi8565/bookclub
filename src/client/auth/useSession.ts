import { useCallback, useEffect, useState } from "react";

// The signed-in user as the client knows it (the session cookie itself is
// httpOnly and never read here).
export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export type SessionStatus = "loading" | "anon" | "authed";

export type ActionResult = { ok: true } | { ok: false; error: string };

export interface Session {
  status: SessionStatus;
  user: SessionUser | null;
  // Request a login code for an email (POST /auth/start).
  startLogin: (email: string) => Promise<ActionResult>;
  // Submit a code to complete sign-in (POST /auth/verify); sets the user on ok.
  verify: (email: string, code: string, displayName?: string) => Promise<ActionResult>;
  signOut: () => Promise<void>;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `http_${response.status}`;
  } catch {
    return `http_${response.status}`;
  }
}

// Tracks the current session, hydrating from /auth/me on mount and exposing the
// sign-in/out actions. The server is the authority; this is just a cache.
export function useSession(): Session {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/auth/me")
      .then(async (r) => (r.ok ? ((await r.json()) as { user: SessionUser }).user : null))
      .catch(() => null)
      .then((u) => {
        if (cancelled) return;
        setUser(u);
        setStatus(u ? "authed" : "anon");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const startLogin = useCallback(async (email: string): Promise<ActionResult> => {
    const r = await fetch("/auth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    return r.ok ? { ok: true } : { ok: false, error: await readError(r) };
  }, []);

  const verify = useCallback(
    async (email: string, code: string, displayName?: string): Promise<ActionResult> => {
      const r = await fetch("/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, displayName }),
      });
      if (!r.ok) return { ok: false, error: await readError(r) };
      const body = (await r.json()) as { user: SessionUser };
      setUser(body.user);
      setStatus("authed");
      return { ok: true };
    },
    [],
  );

  const signOut = useCallback(async (): Promise<void> => {
    await fetch("/auth/signout", { method: "POST" }).catch(() => {});
    setUser(null);
    setStatus("anon");
  }, []);

  return { status, user, startLogin, verify, signOut };
}
