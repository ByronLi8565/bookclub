import { useCallback, useEffect, useState } from "react";

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

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `http_${response.status}`;
  } catch {
    return `http_${response.status}`;
  }
}

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

  const startLogin = useCallback(async (email: string): Promise<StartResult> => {
    const r = await fetch("/auth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!r.ok) return { ok: false, error: await readError(r) };

    if (r.status !== 204) {
      const body = (await r.json().catch(() => null)) as {
        devSignedIn?: boolean;
        user?: SessionUser;
      } | null;
      if (body?.devSignedIn && body.user) {
        setUser(body.user);
        setStatus("authed");
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
