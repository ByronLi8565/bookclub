import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import type { Session } from "../../auth/useSession.ts";
import { createGroup, listMyGroups, type GroupSummary } from "../../groups/api.ts";
import { InviteModal } from "../group/InviteModal.tsx";
import { Loading } from "../shared/Loading.tsx";
import { Login, LoginModal } from "../shared/Login.tsx";
import { spawnToast } from "../shared/toast/store.ts";

// Friendly copy for the name-validation error codes from the server.
const NAME_ERRORS: Record<string, string> = {
  empty: "Enter a name for your club.",
  too_short: "That name is too short — use at least 2 characters.",
  too_long: "That name is too long — 32 characters max.",
  bad_charset:
    "Club names go in the URL, so use only lowercase letters, numbers, and single hyphens (no spaces or symbols).",
  reserved: "That name is reserved — pick another.",
  name_taken: "That name is already taken — pick another.",
};

// The landing page (`/`). Signed in: create a club and jump into the ones you
// belong to. Signed out: sign-in prompt. The login modal is owned here.
export function Home({ session }: { session: Session }): React.ReactElement {
  const authed = session.status === "authed";
  const [loginOpen, setLoginOpen] = useState(false);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState<GroupSummary | null>(null);
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!authed) {
      setGroups([]);
      setGroupsLoading(false);
      return;
    }
    let cancelled = false;
    setGroupsLoading(true);
    void listMyGroups().then((g) => {
      if (cancelled) return;
      setGroups(g);
      setGroupsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [authed]);

  async function onCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const result = await createGroup(name);
    if (!result.ok) {
      const message = NAME_ERRORS[result.error] ?? "Couldn't create that club. Try again.";
      setError(message);
      spawnToast("Invalid club name", message, { type: "error", durationMs: 6000 });
      return;
    }
    navigate(`/${result.value.name}`);
  }

  return (
    <div className="home">
      <div className="home-card">
        <div className="home-corner home-corner--login">
          <Login session={session} onSignIn={() => setLoginOpen(true)} />
        </div>

        <div className="home-main">
          <h1 className="home-title">Bookclub</h1>

          {authed &&
            (creating ? (
              <form onSubmit={(e) => void onCreate(e)} className="home-create">
                <input
                  type="text"
                  placeholder="club name"
                  value={name}
                  // biome-ignore lint/a11y/noAutofocus: focus the input the moment it appears
                  autoFocus
                  onChange={(e) => {
                    setName(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setCreating(false);
                      setName("");
                      setError(null);
                    }
                  }}
                />
                <button
                  type="submit"
                  className="home-create-confirm"
                  aria-label="create"
                  disabled={name === ""}
                >
                  +
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="home-action"
                onClick={() => {
                  setCreating(true);
                  setError(null);
                }}
              >
                create a new bookclub
              </button>
            ))}
          {error && <p className="login-error">{error}</p>}

          <div className="home-clubs">
            {authed ? (
              groupsLoading ? (
                <Loading className="loading--home-clubs" />
              ) : groups.length === 0 ? (
                <span className="home-existing-label">no clubs yet — create one above</span>
              ) : (
                <ul className="home-club-list">
                  {groups.map((g) => (
                    <li key={g.groupId}>
                      <a href={`/${g.name}`}>{g.displayName}</a>
                      {g.ownerId === session.user?.id && (
                        <button type="button" className="login-link" onClick={() => setInviting(g)}>
                          invite
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <span className="home-existing-label">sign in to see your clubs</span>
            )}
          </div>
        </div>

        <div className="home-corner home-corner--credit">a project by Byron Li</div>
      </div>

      {loginOpen && <LoginModal session={session} onClose={() => setLoginOpen(false)} />}
      {inviting && (
        <InviteModal
          name={inviting.name}
          displayName={inviting.displayName}
          onClose={() => setInviting(null)}
        />
      )}
    </div>
  );
}
