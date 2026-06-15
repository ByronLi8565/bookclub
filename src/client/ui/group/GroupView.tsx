import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Session } from "../../auth/useSession.ts";
import {
  fetchGroup,
  redeemInvite,
  renameBook,
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

type Resolved =
  | { k: "loading" }
  | { k: "anon" }
  | { k: "notfound" }
  | { k: "refused" }
  | { k: "member"; group: GroupSummary; isOwner: boolean; members: RosterEntry[] };

interface LoadedFile {
  sourceId: string;
  file: File | null;
}

const SELECTED_SOURCE_PREFIX = "bookclub.selectedSource";
const HOME_TITLE_MAX_SIZE = 72;
const HOME_TITLE_MIN_SIZE = 36;

function selectedSourceKey(groupId: string): string {
  return `${SELECTED_SOURCE_PREFIX}.${groupId}`;
}

function storedSelectedSource(group: GroupSummary): string | null {
  const stored = localStorage.getItem(selectedSourceKey(group.groupId));
  return stored && group.sources.includes(stored) ? stored : null;
}

function takeInviteToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("invite");
  if (token) window.history.replaceState(null, "", window.location.pathname);
  return token;
}

function FittedHomeTitle({ children }: { children: string }): React.ReactElement {
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const [fontSize, setFontSize] = useState(HOME_TITLE_MAX_SIZE);

  useLayoutEffect(() => {
    const title = titleRef.current;
    const container = title?.parentElement;
    if (!title || !container) return;
    const titleEl = title;
    const containerEl = container;

    function fit(): void {
      titleEl.style.fontSize = `${HOME_TITLE_MAX_SIZE}px`;
      const available = containerEl.clientWidth;
      const actual = titleEl.scrollWidth;
      const next =
        actual > available && available > 0
          ? Math.max(HOME_TITLE_MIN_SIZE, Math.floor((HOME_TITLE_MAX_SIZE * available) / actual))
          : HOME_TITLE_MAX_SIZE;
      setFontSize(next);
    }

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(containerEl);
    return () => observer.disconnect();
  }, [children]);

  return (
    <h1 ref={titleRef} className="home-title" style={{ fontSize }}>
      {children}
    </h1>
  );
}

export function GroupView({
  name,
  session,
}: {
  name: string;
  session: Session;
}): React.ReactElement {
  const [resolved, setResolved] = useState<Resolved>({ k: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const userId = session.user?.id ?? null;

  const group = resolved.k === "member" ? resolved.group : null;
  const groupRef = useRef<GroupSummary | null>(null);
  groupRef.current = group;
  const effectiveId = group ? (selectedId ?? currentSourceId(group)) : null;

  function selectBook(sourceId: string): void {
    setSelectedId(sourceId);
    if (group) localStorage.setItem(selectedSourceKey(group.groupId), sourceId);
  }

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
    selectBook(newSourceId);
    setUploadOpen(false);
  }

  const upload = useBookUpload(group, (id) => void onUploaded(id));

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

  function onRenameBook(sourceId: string, title: string): void {
    setResolved((prev) =>
      prev.k === "member"
        ? {
            ...prev,
            group: { ...prev.group, bookTitles: { ...prev.group.bookTitles, [sourceId]: title } },
          }
        : prev,
    );
    void renameBook(name, sourceId, title).then((result) => {
      if (result.ok) {
        setResolved((prev) => (prev.k === "member" ? { ...prev, group: result.value } : prev));
      } else {
        spawnToast("Rename failed", "Couldn't rename that book.", { type: "error" });
      }
    });
  }

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
      setSelectedId(storedSelectedSource(view.group));
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

  useEffect(() => {
    const loadGroup = groupRef.current;
    if (!loadGroup || !effectiveId) return;
    let cancelled = false;
    setLoaded(null);
    void loadSource(loadGroup, effectiveId).then((result) => {
      if (cancelled) return;
      setLoaded({ sourceId: effectiveId, file: result?.file ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [group?.name, effectiveId]);

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

  const source =
    effectiveId && group ? (sourceById(group, effectiveId) ?? currentSource(group)) : null;

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
        onSelectBook={selectBook}
        onRenameBook={onRenameBook}
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
          <FittedHomeTitle>{group.displayName}</FittedHomeTitle>
          <button
            type="button"
            className="home-upload-link plain-button"
            onClick={onUpload}
            title="Upload a book or PDF"
          >
            upload the club&apos;s book or PDF
          </button>
        </div>
      </div>
    </div>
  );
}
