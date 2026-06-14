import { useEffect, useState } from "react";
import type { Session } from "../../auth/useSession.ts";
import {
  fetchGroup,
  redeemInvite,
  resolveBookTitle,
  type GroupSummary,
  type RosterEntry,
} from "../../groups/api.ts";
import { books, loadSource } from "../../groups/sourceAccess.ts";
import { useBookUpload } from "../../groups/useBookUpload.ts";
import { currentSource, currentSourceId, sourceById } from "../../../shared/sources.ts";
import { Workspace } from "../../app/Workspace.tsx";
import { Login, LoginModal } from "../shared/Login.tsx";
import { Loading } from "../shared/Loading.tsx";
import { spawnToast } from "../shared/toast/store.ts";
import { UploadModal } from "./UploadModal.tsx";

// The resolved membership state of a group route. Once a caller is a confirmed
// member we hold the group + roster here and handle book selection/loading
// separately, so switching books never re-runs membership resolution.
type Resolved =
  | { k: "loading" }
  | { k: "anon" }
  | { k: "notfound" }
  | { k: "refused" }
  | { k: "member"; group: GroupSummary; isOwner: boolean; members: RosterEntry[] };

// The locally-loaded bytes for one book, tagged with the sourceId they belong to
// so a render can tell whether the loaded file still matches the selection.
interface LoadedFile {
  sourceId: string;
  file: File | null;
}

// Pull a one-shot invite token off the URL and strip it so a refresh or a failed
// redeem doesn't keep re-triggering.
function takeInviteToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("invite");
  if (token) window.history.replaceState(null, "", window.location.pathname);
  return token;
}

// Mounted at `/:name`. Resolves the group, redeems a pending `?invite`, enforces
// membership, loads the selected book from the worker, and hands off to the
// reader workspace. Non-members are refused; signed-out visitors are prompted.
// A club may bind several books; the selected one is held in client state and
// defaults to the club's first (current) book.
export function GroupView({
  name,
  session,
}: {
  name: string;
  session: Session;
}): React.ReactElement {
  const [resolved, setResolved] = useState<Resolved>({ k: "loading" });
  // The book the reader is showing; null means "use the club's default book".
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  // Whether the add-a-book upload modal is open (any member may open it).
  const [uploadOpen, setUploadOpen] = useState(false);
  const userId = session.user?.id ?? null;

  const group = resolved.k === "member" ? resolved.group : null;
  const effectiveId = group ? (selectedId ?? currentSourceId(group)) : null;

  // After an upload, fold the refreshed group into state and jump to the new
  // book. Doesn't bump `reload`, so membership resolution doesn't re-run.
  async function onUploaded(newSourceId: string): Promise<void> {
    const refreshed = await fetchGroup(name);
    if (refreshed?.membership.isMember) {
      setResolved({
        k: "member",
        group: refreshed.group,
        isOwner: refreshed.group.ownerId === userId,
        members: refreshed.members,
      });
    }
    setSelectedId(newSourceId);
    setUploadOpen(false);
  }

  const upload = useBookUpload(group, (id) => void onUploaded(id));

  // Read-repair: the reader decoded a metadata title for a book the club has no
  // label for. Record it locally (so the switcher updates and the effect won't
  // refire) and back it up to the server, which set-if-absent ignores duplicates.
  function onTitleParsed(sourceId: string, title: string): void {
    setResolved((prev) => {
      if (prev.k !== "member") return prev;
      const meta = prev.group.sourceMeta[sourceId];
      if (!meta || (meta.title ?? "") !== "") return prev;
      return {
        ...prev,
        group: {
          ...prev.group,
          sourceMeta: { ...prev.group.sourceMeta, [sourceId]: { ...meta, title } },
        },
      };
    });
    void resolveBookTitle(name, sourceId, title);
  }

  // Resolve membership (and redeem a pending invite). Re-runs only on identity /
  // route changes, never on a book switch.
  useEffect(() => {
    if (session.status === "loading") return;
    if (session.status === "anon") {
      setResolved({ k: "anon" });
      return;
    }

    let cancelled = false;
    setResolved({ k: "loading" });
    setSelectedId(null);
    setLoaded(null);

    void (async () => {
      let view = await fetchGroup(name);
      if (!view) {
        if (!cancelled) setResolved({ k: "notfound" });
        return;
      }
      if (!view.membership.isMember) {
        const token = takeInviteToken();
        if (token) {
          const joined = await redeemInvite(name, token);
          if (joined.ok) view = (await fetchGroup(name)) ?? view;
          else spawnToast("Invite failed", "That invite link isn't valid.", { type: "error" });
        }
      }
      if (cancelled) return;
      if (!view.membership.isMember) {
        setResolved({ k: "refused" });
        return;
      }
      setResolved({
        k: "member",
        group: view.group,
        isOwner: view.group.ownerId === userId,
        members: view.members,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [name, session.status, userId]);

  // Load the selected book's bytes whenever the selection (or group) changes.
  useEffect(() => {
    if (!group || !effectiveId) return;
    let cancelled = false;
    setLoaded(null);
    void loadSource(group, effectiveId).then((result) => {
      if (cancelled) return;
      setLoaded({ sourceId: effectiveId, file: result?.file ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [group, effectiveId]);

  if (resolved.k === "loading") {
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
  if (resolved.k === "anon")
    return <GroupGate session={session} message="Sign in to open this club." />;
  if (resolved.k === "notfound")
    return <GroupMessage title="No such club" body={`"${name}" doesn't exist.`} />;
  if (resolved.k === "refused") {
    return <GroupMessage title="Members only" body="You need an invite to join this club." />;
  }

  // The active book, if the library is non-empty and the selection resolves.
  const source =
    effectiveId && group ? (sourceById(group, effectiveId) ?? currentSource(group)) : null;

  // An empty library (or unresolved selection): any member can add the first
  // book. The upload modal is shared with the in-reader "add a book" action.
  const content =
    !group || !source ? (
      <NoBook group={resolved.group} onUpload={() => setUploadOpen(true)} />
    ) : (
      <Workspace
        name={group.name}
        groupName={group.displayName}
        groupId={group.groupId}
        source={source}
        file={loaded?.sourceId === source.id ? loaded.file : null}
        storedBookTitle={source.title}
        onTitleParsed={onTitleParsed}
        books={books(group)}
        selectedSourceId={source.id}
        onSelectBook={setSelectedId}
        onAddBook={() => setUploadOpen(true)}
        members={resolved.members}
        viewer={{ userId: userId ?? "", isOwner: resolved.isOwner }}
      />
    );

  return (
    <>
      {content}
      {uploadOpen && <UploadModal upload={upload} onClose={() => setUploadOpen(false)} />}
    </>
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

// The club's library is empty: any member can add the first book. The button
// opens the upload modal, where admission (health check + metadata preview)
// happens before the file is committed.
function NoBook({
  group,
  onUpload,
}: {
  group: GroupSummary;
  onUpload: () => void;
}): React.ReactElement {
  return (
    <div className="home">
      <div className="home-card">
        <a className="home-back" href="/" aria-label="back to your clubs">
          ‹
        </a>
        <div className="home-main">
          <h1 className="home-title">{group.displayName}</h1>
          <button type="button" className="home-upload-link plain-button" onClick={onUpload}>
            upload the club&apos;s book or PDF
          </button>
        </div>
      </div>
    </div>
  );
}
