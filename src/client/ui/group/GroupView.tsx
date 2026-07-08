import * as Effect from "effect/Effect";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Session } from "../../app/useSession.ts";
import {
  fetchGroup,
  redeemInvite,
  renameBook,
  resolveBookTitle,
  type GroupSummary,
  type RosterEntry,
} from "../../logic/groups/groupClient.ts";
import { useOnline } from "../../logic/net/online.ts";
import { readLocal, writeLocal } from "../../logic/storage.ts";
import { books, downloadGroupForOffline, loadSource } from "../../logic/groups/sourceAccess.ts";
import { isNative } from "../../logic/net/api.ts";
import { useBookUpload } from "../../logic/groups/useBookUpload.ts";
import {
  fetchServerReadingPosition,
  getReadingPosition,
  setLocalReadingPosition,
  syncReadingPosition,
} from "../../logic/settings/readingPositions.ts";
import { currentSource, currentSourceId, sourceById } from "../../../shared/sources.ts";
import { Workspace } from "../../app/Workspace.tsx";
import { Login, LoginModal } from "../shared/Login.tsx";
import { useIsMobile } from "../shared/hooks/useIsMobile.ts";
import { spawnToast } from "../shared/toast/toastStore.ts";
import { UploadModal } from "./UploadModal.tsx";
import { WorkspaceLoadingShell } from "./WorkspaceLoadingShell.tsx";

type Resolved =
  | { k: "loading" }
  | { k: "anon" }
  | { k: "notfound" }
  | { k: "refused" }
  | { k: "offline" }
  | { k: "member"; group: GroupSummary; isOwner: boolean; members: RosterEntry[] };

interface CachedGroupView {
  group: GroupSummary;
  isOwner: boolean;
  members: RosterEntry[];
}

function groupViewCacheKey(userId: string, groupRef: string): string {
  return `bookclub.groupview.${userId}.${groupRef}`;
}

type LoadedFiles = Record<string, File | null>;

const SELECTED_SOURCE_PREFIX = "bookclub.selectedSource";
const HOME_TITLE_MAX_SIZE = 72;
const HOME_TITLE_MIN_SIZE = 28;

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
    let cancelled = false;

    function fit(): void {
      if (cancelled) return;
      const previousWhiteSpace = titleEl.style.whiteSpace;
      titleEl.style.whiteSpace = "nowrap";
      titleEl.style.fontSize = `${HOME_TITLE_MAX_SIZE}px`;
      const available = containerEl.clientWidth;
      const actual = titleEl.scrollWidth;
      const next =
        actual > available && available > 0
          ? Math.max(HOME_TITLE_MIN_SIZE, Math.floor((HOME_TITLE_MAX_SIZE * available) / actual))
          : HOME_TITLE_MAX_SIZE;
      titleEl.style.fontSize = `${next}px`;
      titleEl.style.whiteSpace = previousWhiteSpace;
      setFontSize(next);
    }

    fit();
    requestAnimationFrame(() => requestAnimationFrame(fit));
    void document.fonts?.ready.then(fit);
    const observer = new ResizeObserver(fit);
    observer.observe(containerEl);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [children]);

  return (
    <h1 ref={titleRef} className="home-title" style={{ fontSize }}>
      {children}
    </h1>
  );
}

export function GroupView({
  groupRef,
  session,
}: {
  groupRef: string;
  session: Session;
}): React.ReactElement {
  const [resolved, setResolved] = useState<Resolved>({ k: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadedFiles, setLoadedFiles] = useState<LoadedFiles>({});
  const loadedFilesRef = useRef<LoadedFiles>({});
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const userId = session.user?.id ?? null;
  const online = useOnline();
  const isMobile = useIsMobile();
  const loadKey = `${groupRef}:${session.status}:${userId ?? ""}`;
  const loadKeyRef = useRef(loadKey);

  if (loadKeyRef.current !== loadKey) {
    loadKeyRef.current = loadKey;
    if (session.status === "anon") {
      setResolved({ k: "anon" });
    } else if (session.status === "authed") {
      setResolved({ k: "loading" });
      setSelectedId(null);
      setLoadedFiles({});
    }
  }

  const group = resolved.k === "member" ? resolved.group : null;
  const groupStateRef = useRef<GroupSummary | null>(null);
  groupStateRef.current = group;
  loadedFilesRef.current = loadedFiles;
  const effectiveId = group ? (selectedId ?? currentSourceId(group)) : null;

  function selectBook(sourceId: string): void {
    setSelectedId(sourceId);
    if (group) localStorage.setItem(selectedSourceKey(group.groupId), sourceId);
  }

  async function onUploaded(newSourceId: string): Promise<void> {
    const refreshed = await fetchGroup(groupRef);
    if (refreshed.status === "ok" && refreshed.membership.isMember) {
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
    void resolveBookTitle(groupRef, sourceId, title);
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
    void renameBook(groupRef, sourceId, title).then((result) => {
      if (result.ok) {
        setResolved((prev) => (prev.k === "member" ? { ...prev, group: result.value } : prev));
      } else {
        spawnToast("Rename failed", "Couldn't rename that book.", { type: "error" });
      }
    });
  }

  const wasOnlineRef = useRef(online);
  useEffect(() => {
    if (online && !wasOnlineRef.current) setReloadTick((t) => t + 1);
    wasOnlineRef.current = online;
  }, [online]);

  useEffect(() => {
    let cancelled = false;
    if (session.status === "loading") return;
    if (session.status === "anon") return;

    void (async () => {
      let view = await fetchGroup(groupRef);
      if (view.status === "notfound") {
        if (!cancelled) setResolved({ k: "notfound" });
        return;
      }
      if (view.status === "error") {
        if (cancelled) return;
        const cached = userId
          ? readLocal<CachedGroupView>(groupViewCacheKey(userId, groupRef))
          : null;
        if (cached) {
          setSelectedId(storedSelectedSource(cached.group));
          setResolved({ k: "member", ...cached });
        } else {
          setResolved({ k: "offline" });
        }
        return;
      }
      if (!view.membership.isMember) {
        const token = takeInviteToken();
        if (token) {
          const joined = await redeemInvite(groupRef, token);
          if (joined.ok) {
            const rejoined = await fetchGroup(groupRef);
            if (rejoined.status === "ok") view = rejoined;
          } else {
            spawnToast("Invite failed", "That invite link isn't valid.", { type: "error" });
          }
        }
      }
      if (cancelled) return;
      if (view.status !== "ok" || !view.membership.isMember) {
        setResolved({ k: "refused" });
        return;
      }
      const resolvedView: CachedGroupView = {
        group: view.group,
        isOwner: view.group.ownerId === userId,
        members: view.members,
      };
      if (userId) writeLocal(groupViewCacheKey(userId, groupRef), resolvedView);
      setSelectedId(storedSelectedSource(view.group));
      setResolved({ k: "member", ...resolvedView });
    })();
    return () => {
      cancelled = true;
    };
  }, [groupRef, session.status, userId, reloadTick]);

  useEffect(() => {
    let cancelled = false;
    const loadGroup = groupStateRef.current;
    if (!loadGroup || !effectiveId) return;
    if (Object.hasOwn(loadedFilesRef.current, effectiveId)) return;
    void loadSource(loadGroup, effectiveId).then((result) => {
      if (cancelled) return;
      setLoadedFiles((current) => ({ ...current, [effectiveId]: result?.file ?? null }));
    });
    return () => {
      cancelled = true;
    };
  }, [group?.groupId, effectiveId]);

  useEffect(() => {
    // Read through the ref (like the loadSource effect above) so the deps stay
    // the primitives that should actually retrigger a shelf sync.
    const shelf = groupStateRef.current;
    if (!isNative || !shelf) return;
    void downloadGroupForOffline(shelf);
    // Keyed on identity + shelf contents so a newly-added book also downloads.
  }, [group?.groupId, group?.sources.length]);

  const source =
    effectiveId && group ? (sourceById(group, effectiveId) ?? currentSource(group)) : null;
  const groupId = group?.groupId ?? null;
  const restoreSourceId = source?.id ?? null;
  const sourceKind = source?.kind ?? null;

  const initialPosition = useMemo(
    () =>
      userId && groupId && restoreSourceId && sourceKind
        ? (getReadingPosition(userId, groupId, restoreSourceId, sourceKind)?.position ?? null)
        : null,
    [userId, groupId, restoreSourceId, sourceKind],
  );

  useEffect(() => {
    if (!userId || !groupId || !restoreSourceId) return;
    void Effect.runPromise(
      fetchServerReadingPosition(userId, groupId, restoreSourceId).pipe(
        Effect.orElseSucceed(() => null),
      ),
    );
  }, [userId, groupId, restoreSourceId]);

  useEffect(() => {
    if (!userId || !groupId || !restoreSourceId) return;
    const sync = () => {
      void Effect.runPromise(syncReadingPosition(userId, groupId, restoreSourceId)).catch(() => {});
    };
    const interval = window.setInterval(sync, 3000);
    return () => window.clearInterval(interval);
  }, [userId, groupId, restoreSourceId]);

  const loaded = source ? loadedFiles[source.id] : null;

  const forceSyncReadingPosition = useMemo(
    () =>
      userId && groupId
        ? (sourceId: string) => syncReadingPosition(userId, groupId, sourceId, true)
        : () => Effect.succeed(false),
    [userId, groupId],
  );

  if (resolved.k === "loading") {
    return <WorkspaceLoadingShell isMobile={isMobile} />;
  }
  if (resolved.k === "anon")
    return <GroupGate session={session} message="Sign in to open this club." />;
  if (resolved.k === "notfound")
    return <GroupMessage title="No such club" body={`"${groupRef}" doesn't exist.`} />;
  if (resolved.k === "offline")
    return (
      <GroupMessage
        title="You're offline"
        body="Can't reach the server, and this club isn't cached on this device yet. Reconnect and try again."
      />
    );
  if (resolved.k === "refused") {
    return <GroupMessage title="Members only" body="You need an invite to join this club." />;
  }

  const content =
    !group || !source ? (
      <NoBook group={resolved.group} onUpload={() => setUploadOpen(true)} />
    ) : (
      <Workspace
        groupName={group.displayName}
        groupRef={groupRef}
        groupId={group.groupId}
        source={source}
        file={loaded ?? null}
        storedBookTitle={source.title}
        onTitleParsed={onTitleParsed}
        initialReadingPosition={initialPosition}
        onReadingPosition={(sourceId, position) => {
          if (userId) setLocalReadingPosition(userId, group.groupId, sourceId, position);
        }}
        onSyncReadingPosition={forceSyncReadingPosition}
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
