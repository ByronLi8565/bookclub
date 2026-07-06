import { useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import { useLocation } from "wouter";
import { groupUrlName } from "../../../shared/groupUrls.ts";
import type { Session } from "../../app/useSession.ts";
import { createGroup, listMyGroups, type GroupSummary } from "../../logic/groups/groupClient.ts";
import { readLocal, writeLocal } from "../../logic/storage.ts";
import { useOnline } from "../../logic/net/online.ts";
import { InviteModal } from "../group/InviteModal.tsx";
import { InfoScreen } from "../shared/InfoScreen.tsx";
import { Loading } from "../shared/Loading.tsx";
import { Login, LoginModal } from "../shared/Login.tsx";
import { spawnToast } from "../shared/toast/toastStore.ts";

const NAME_ERRORS: Record<string, string> = {
  empty: "Enter a name for your club.",
  too_long: "That name is too long! 100 characters max.",
};

interface GroupsStore {
  groups: GroupSummary[];
  loading: boolean;
  failed: boolean;
}

interface HomeState {
  loginOpen: boolean;
  name: string;
  creating: boolean;
  createPending: boolean;
  error: string | null;
  inviting: GroupSummary | null;
  infoOpen: boolean;
}

type HomeAction =
  | { type: "login"; open: boolean }
  | { type: "info"; open: boolean }
  | { type: "invite"; group: GroupSummary | null }
  | { type: "startCreating" }
  | { type: "cancelCreating" }
  | { type: "name"; name: string }
  | { type: "createSubmit" }
  | { type: "createError"; error: string }
  | { type: "createDone" };

const initialHomeState: HomeState = {
  loginOpen: false,
  name: "",
  creating: false,
  createPending: false,
  error: null,
  inviting: null,
  infoOpen: false,
};

function homeReducer(state: HomeState, action: HomeAction): HomeState {
  switch (action.type) {
    case "login":
      return { ...state, loginOpen: action.open };
    case "info":
      return { ...state, infoOpen: action.open };
    case "invite":
      return { ...state, inviting: action.group };
    case "startCreating":
      return { ...state, creating: true, error: null };
    case "cancelCreating":
      return { ...state, creating: false, name: "", error: null };
    case "name":
      return { ...state, name: action.name, error: null };
    case "createSubmit":
      return { ...state, createPending: true, error: null };
    case "createError":
      return { ...state, createPending: false, error: action.error };
    case "createDone":
      return { ...state, createPending: false };
  }
}

let groupsStore: GroupsStore = { groups: [], loading: false, failed: false };
let groupsRequest = 0;
const groupsListeners = new Set<() => void>();

function setGroupsStore(next: GroupsStore): void {
  groupsStore = next;
  for (const listener of groupsListeners) listener();
}

function subscribeGroups(listener: () => void): () => void {
  groupsListeners.add(listener);
  return () => groupsListeners.delete(listener);
}

function groupsCacheKey(userId: string): string {
  return `bookclub.groups.${userId}`;
}

function loadGroups(authed: boolean, userId: string | null): void {
  const request = ++groupsRequest;
  if (!authed || !userId) {
    setGroupsStore({ groups: [], loading: false, failed: false });
    return;
  }
  // Paint the last-known list immediately (instant, works offline), then refresh.
  const cached = readLocal<GroupSummary[]>(groupsCacheKey(userId)) ?? [];
  setGroupsStore({ groups: cached, loading: true, failed: false });
  void listMyGroups()
    .catch(() => ({ ok: false as const, error: "offline" }))
    .then((result) => {
      if (request !== groupsRequest) return;
      if (!result.ok) {
        // Network/server failure: keep showing the cache; only flag failure when
        // we have nothing to show.
        setGroupsStore({ groups: cached, loading: false, failed: cached.length === 0 });
        if (cached.length === 0) {
          spawnToast("Couldn't load your clubs", "You appear to be offline. Try again later.", {
            type: "error",
            durationMs: 6000,
          });
        }
        return;
      }
      writeLocal(groupsCacheKey(userId), result.value);
      setGroupsStore({ groups: result.value, loading: false, failed: false });
    });
}

export function Home({ session }: { session: Session }): React.ReactElement {
  const authed = session.status === "authed";
  const [state, dispatch] = useReducer(homeReducer, initialHomeState);
  const { loginOpen, name, creating, createPending, error, inviting, infoOpen } = state;
  const {
    groups,
    loading: groupsLoading,
    failed: groupsFailed,
  } = useSyncExternalStore(
    subscribeGroups,
    () => groupsStore,
    () => groupsStore,
  );
  const createInFlight = useRef(false);
  const [, navigate] = useLocation();
  const userId = session.user?.id ?? null;
  const online = useOnline();

  useEffect(() => {
    loadGroups(authed, userId);
  }, [authed, userId]);

  // Refresh the club list when connectivity returns.
  useEffect(() => {
    if (online && authed) loadGroups(authed, userId);
  }, [online, authed, userId]);

  async function onCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (createInFlight.current) return;
    createInFlight.current = true;
    dispatch({ type: "createSubmit" });
    const result = await createGroup(name).catch(() => ({ ok: false as const, error: "network" }));
    createInFlight.current = false;
    if (!result.ok) {
      const message = NAME_ERRORS[result.error] ?? "Couldn't create that club. Try again.";
      dispatch({ type: "createError", error: message });
      spawnToast("Invalid club name", message, { type: "error", durationMs: 6000 });
      return;
    }
    dispatch({ type: "createDone" });
    navigate(`/clubs/${groupUrlName(result.value)}`);
  }

  return (
    <div className="home">
      <div className="home-card">
        <button
          type="button"
          className="home-info-button"
          aria-label="open info"
          title="About & release log"
          onClick={() => dispatch({ type: "info", open: true })}
        >
          i
        </button>

        <div className="home-corner home-corner--login">
          <Login session={session} onSignIn={() => dispatch({ type: "login", open: true })} />
        </div>

        <div className="home-main">
          <h1 className="home-title">Bookclub</h1>

          {authed &&
            (creating ? (
              <form onSubmit={(e) => void onCreate(e)} className="home-create">
                <input
                  type="text"
                  aria-label="Club name"
                  placeholder="club name"
                  value={name}
                  onChange={(e) => {
                    dispatch({ type: "name", name: e.target.value });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      dispatch({ type: "cancelCreating" });
                    }
                  }}
                />
                <button
                  type="submit"
                  className="home-create-confirm"
                  aria-label="create"
                  title="Create club"
                  disabled={name === "" || createPending}
                >
                  +
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="home-action"
                title="Create a new bookclub"
                onClick={() => {
                  dispatch({ type: "startCreating" });
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
              ) : groupsFailed && groups.length === 0 ? (
                <span className="home-existing-label">
                  unable to load your clubs — refresh to try again
                </span>
              ) : groups.length === 0 ? (
                <span className="home-existing-label">no clubs yet — create one above</span>
              ) : (
                <ul className="home-club-list">
                  {groups.map((g) => (
                    <li key={g.groupId}>
                      <a href={`/clubs/${groupUrlName(g)}`}>{g.displayName}</a>
                      <button
                        type="button"
                        className="login-link plain-button"
                        title="Invite people"
                        onClick={() => dispatch({ type: "invite", group: g })}
                      >
                        invite
                      </button>
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

      {infoOpen && <InfoScreen onClose={() => dispatch({ type: "info", open: false })} />}

      {loginOpen && (
        <LoginModal session={session} onClose={() => dispatch({ type: "login", open: false })} />
      )}
      {inviting && (
        <InviteModal
          groupRef={groupUrlName(inviting)}
          displayName={inviting.displayName}
          onClose={() => dispatch({ type: "invite", group: null })}
        />
      )}
    </div>
  );
}
