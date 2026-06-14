import { useEffect, useState } from "react";
import type { Session } from "../../auth/useSession.ts";
import { fetchGroup, redeemInvite, type GroupSummary, type RosterEntry } from "../../groups/api.ts";
import {
  currentBookRef,
  loadCurrentGroupBook,
  uploadCurrentGroupBook,
  type LoadedGroupBook,
} from "../../groups/bookAccess.ts";
import { Workspace } from "../../app/Workspace.tsx";
import { Login, LoginModal } from "../shared/Login.tsx";
import { Loading } from "../shared/Loading.tsx";
import { spawnToast } from "../shared/toast/store.ts";

// The resolved state of a group route. Each variant maps to a distinct render.
type View =
  | { k: "loading" }
  | { k: "anon" }
  | { k: "notfound" }
  | { k: "refused" }
  | { k: "nobook"; group: GroupSummary; isOwner: boolean }
  | {
      k: "ready";
      group: GroupSummary;
      sourceId: string;
      book: LoadedGroupBook | null;
      isOwner: boolean;
      members: RosterEntry[];
    };

// Pull a one-shot invite token off the URL and strip it so a refresh or a failed
// redeem doesn't keep re-triggering.
function takeInviteToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("invite");
  if (token) window.history.replaceState(null, "", window.location.pathname);
  return token;
}

// Mounted at `/:name`. Resolves the group, redeems a pending `?invite`, enforces
// membership, loads the group's book from the worker, and hands off to the
// reader workspace. Non-members are refused; signed-out visitors are prompted.
export function GroupView({
  name,
  session,
}: {
  name: string;
  session: Session;
}): React.ReactElement {
  const [view, setView] = useState<View>({ k: "loading" });
  const [reload, setReload] = useState(0);
  const userId = session.user?.id ?? null;

  useEffect(() => {
    if (session.status === "loading") return;
    if (session.status === "anon") {
      setView({ k: "anon" });
      return;
    }

    let cancelled = false;
    setView({ k: "loading" });

    void (async () => {
      // Resolve membership, redeeming a pending invite first if present.
      let resolved = await fetchGroup(name);
      if (!resolved) {
        if (!cancelled) setView({ k: "notfound" });
        return;
      }
      if (!resolved.membership.isMember) {
        const token = takeInviteToken();
        if (token) {
          const joined = await redeemInvite(name, token);
          // Refetch so the roster and membership reflect the new join.
          if (joined.ok) resolved = (await fetchGroup(name)) ?? resolved;
          else spawnToast("Invite failed", "That invite link isn't valid.", { type: "error" });
        }
      }
      if (cancelled) return;
      if (!resolved.membership.isMember) {
        setView({ k: "refused" });
        return;
      }

      const isOwner = resolved.group.ownerId === userId;
      const ref = currentBookRef(resolved.group);
      if (!ref) {
        setView({ k: "nobook", group: resolved.group, isOwner });
        return;
      }

      setView({
        k: "ready",
        group: resolved.group,
        sourceId: ref.sourceId,
        book: null,
        isOwner,
        members: resolved.members,
      });
      const book = await loadCurrentGroupBook(resolved.group);
      if (cancelled) return;
      if (book)
        setView({
          k: "ready",
          group: resolved.group,
          sourceId: book.sourceId,
          book,
          isOwner,
          members: resolved.members,
        });
      else setView({ k: "nobook", group: resolved.group, isOwner });
    })();

    return () => {
      cancelled = true;
    };
  }, [name, session.status, userId, reload]);

  if (view.k === "loading") {
    return (
      <div className="home">
        <div className="home-card">
          <div className="home-main">
            <Loading />
          </div>
        </div>
      </div>
    );
  }
  if (view.k === "anon")
    return <GroupGate session={session} message="Sign in to open this club." />;
  if (view.k === "notfound")
    return <GroupMessage title="No such club" body={`"${name}" doesn't exist.`} />;
  if (view.k === "refused") {
    return <GroupMessage title="Members only" body="You need an invite to join this club." />;
  }
  if (view.k === "nobook") {
    return (
      <NoBook
        name={name}
        group={view.group}
        isOwner={view.isOwner}
        onUploaded={() => setReload((n) => n + 1)}
      />
    );
  }
  return (
    <Workspace
      name={view.group.name}
      groupName={view.group.displayName}
      groupId={view.group.groupId}
      sourceId={view.book?.sourceId ?? view.sourceId}
      file={view.book?.file ?? null}
      bookTitleOverride={view.group.bookTitles[view.book?.sourceId ?? view.sourceId] ?? null}
      members={view.members}
      viewer={{ userId: userId ?? "", isOwner: view.isOwner }}
    />
  );
}

// A centered notice card (not-found / refused), with a way back home.
function GroupMessage({ title, body }: { title: string; body: string }): React.ReactElement {
  return (
    <div className="home">
      <div className="home-card">
        <a className="home-back" href="/" aria-label="back to your clubs">
          ‹
        </a>
        <div className="home-main">
          <h1 className="home-title">{title}</h1>
          <p>{body}</p>
        </div>
      </div>
    </div>
  );
}

// Signed-out visitor to a club URL: prompt sign-in (the modal stays open). After
// sign-in the effect re-runs and redeems any invite automatically.
function GroupGate({
  session,
  message,
}: {
  session: Session;
  message: string;
}): React.ReactElement {
  return (
    <div className="home">
      <div className="home-card">
        <div className="home-corner home-corner--login">
          <Login session={session} onSignIn={() => {}} />
        </div>
        <div className="home-main">
          <h1 className="home-title">Bookclub</h1>
          <p>{message}</p>
        </div>
      </div>
      <LoginModal session={session} onClose={() => {}} />
    </div>
  );
}

// The group has no book yet: the owner can upload one; everyone else waits.
function NoBook({
  name,
  group,
  isOwner,
  onUploaded,
}: {
  name: string;
  group: GroupSummary;
  isOwner: boolean;
  onUploaded: () => void;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);

  async function onPick(file: File): Promise<void> {
    setBusy(true);
    const result = await uploadCurrentGroupBook(name, file);
    if (result.ok) {
      onUploaded();
    } else {
      setBusy(false);
      spawnToast("Upload failed", "Couldn't store that book. Try again.", { type: "error" });
    }
  }

  return (
    <div className="home">
      <div className="home-card">
        <a className="home-back" href="/" aria-label="back to your clubs">
          ‹
        </a>
        <div className="home-main">
          <h1 className="home-title">{group.displayName}</h1>
          {isOwner ? (
            <label className="home-upload-link">
              {busy ? <Loading className="loading--inline" /> : "upload the club's book (epub)"}
              <input
                type="file"
                accept=".epub,application/epub+zip"
                disabled={busy}
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPick(f);
                }}
              />
            </label>
          ) : (
            <p>Waiting for the owner to add a book.</p>
          )}
        </div>
      </div>
    </div>
  );
}
