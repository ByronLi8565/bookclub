import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schedule from "effect/Schedule";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Session } from "../../app/useSession.ts";
import {
  changeMemberRole,
  deleteBook as deleteGroupBook,
  fetchGroup,
  renameBook,
  resolveBookTitle,
  updateBookMetadata,
  type BookMetadataPatch,
  type GroupSummary,
  type GroupRole,
} from "../../logic/groups/groupClient.ts";
import { books, downloadGroupForOffline, loadSource } from "../../logic/groups/sourceAccess.ts";
import { isNative } from "../../logic/net/api.ts";
import { useBookUpload } from "../../logic/groups/useBookUpload.ts";
import { useLatestRef } from "../../logic/useLatestRef.ts";
import { useResolvedGroup } from "../../logic/groups/useResolvedGroup.ts";
import {
  setLocalReadingPosition,
  syncReadingPosition,
} from "../../logic/settings/readingPositions.ts";
import { useOpeningReadingPosition } from "../../logic/settings/useOpeningReadingPosition.ts";
import { useReaderPrefs } from "../../logic/settings/userPrefs.ts";
import { currentSource, currentSourceId, sourceById } from "../../../shared/sources.ts";
import type { ClubProfile } from "../../../shared/types/profiles.ts";
import { GroupRole as GroupRoles } from "../../../shared/types/groups.ts";
import { Workspace } from "../../app/Workspace.tsx";
import { Login, LoginModal } from "../shared/Login.tsx";
import { useIsMobile } from "../shared/hooks/useIsMobile.ts";
import { spawnToast } from "../shared/toast/toastStore.ts";
import { UploadModal } from "./UploadModal.tsx";
import { WorkspaceLoadingShell } from "./WorkspaceLoadingShell.tsx";

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
  const [resolved, setResolved, selectedId, setSelectedId] = useResolvedGroup(
    groupRef,
    session,
    storedSelectedSource,
  );
  const [loadedFiles, setLoadedFiles] = useState<LoadedFiles>({});
  const [uploadOpen, setUploadOpen] = useState(false);
  const userId = session.user?.id ?? null;
  const isMobile = useIsMobile();
  const { readingPositionOpenPolicy } = useReaderPrefs();
  const loadKey = `${groupRef}:${session.status}:${userId ?? ""}`;
  const [loadedFor, setLoadedFor] = useState(loadKey);

  if (loadedFor !== loadKey) {
    setLoadedFor(loadKey);
    if (session.status === "authed") setLoadedFiles({});
  }

  const group = resolved.k === "member" ? resolved.group : null;
  const groupStateRef = useLatestRef(group);
  const loadedFilesRef = useLatestRef(loadedFiles);
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
        role: refreshed.membership.role ?? GroupRoles.Visitor,
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

  async function onDeleteBook(sourceId: string): Promise<boolean> {
    const result = await deleteGroupBook(groupRef, sourceId);
    if (!result.ok) {
      spawnToast("Delete failed", "Couldn't delete that book.", { type: "error" });
      return false;
    }
    const nextGroup = result.value;
    setResolved((current) => (current.k === "member" ? { ...current, group: nextGroup } : current));
    setLoadedFiles((current) => {
      const { [sourceId]: _deleted, ...remaining } = current;
      return remaining;
    });
    if (effectiveId === sourceId) {
      const nextId = currentSourceId(nextGroup);
      setSelectedId(nextId);
      if (nextId) localStorage.setItem(selectedSourceKey(nextGroup.groupId), nextId);
      else localStorage.removeItem(selectedSourceKey(nextGroup.groupId));
    }
    return true;
  }

  async function onChangeMemberRole(memberId: string, role: GroupRole): Promise<boolean> {
    const result = await changeMemberRole(groupRef, memberId, role);
    if (!result.ok) {
      spawnToast("Role change failed", "Couldn't change that member's role.", { type: "error" });
      return false;
    }
    setResolved((current) =>
      current.k === "member" ? { ...current, members: result.value } : current,
    );
    return true;
  }

  async function onUpdateBookMetadata(
    sourceId: string,
    patch: BookMetadataPatch,
  ): Promise<boolean> {
    const result = await updateBookMetadata(groupRef, sourceId, patch);
    if (!result.ok) {
      spawnToast("Update failed", "Couldn't update that book's metadata.", { type: "error" });
      return false;
    }
    setResolved((current) =>
      current.k === "member" ? { ...current, group: result.value } : current,
    );
    return true;
  }

  function onProfileChange(profile: ClubProfile): void {
    setResolved((current) =>
      current.k === "member"
        ? {
            ...current,
            members: current.members.map((member) =>
              member.id === profile.id
                ? {
                    ...member,
                    name: profile.displayName,
                    ...(profile.avatarImageId ? { avatarImageId: profile.avatarImageId } : {}),
                  }
                : member,
            ),
          }
        : current,
    );
  }

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
  }, [group?.groupId, effectiveId, groupStateRef, loadedFilesRef]);

  useEffect(() => {
    // Read through the ref (like the loadSource effect above) so the deps stay
    // the primitives that should actually retrigger a shelf sync.
    const shelf = groupStateRef.current;
    if (!isNative || !shelf) return;
    void downloadGroupForOffline(shelf);
    // Keyed on identity + shelf contents so a newly-added book also downloads.
  }, [group?.groupId, group?.sources.length, groupStateRef]);

  const source =
    effectiveId && group ? (sourceById(group, effectiveId) ?? currentSource(group)) : null;
  const groupId = group?.groupId ?? null;
  const restoreSourceId = source?.id ?? null;
  const sourceKind = source?.kind ?? null;

  const openingPosition = useOpeningReadingPosition({
    userId,
    groupId,
    sourceId: restoreSourceId,
    sourceKind,
    policy: readingPositionOpenPolicy,
  });

  useEffect(() => {
    if (!userId || !groupId || !restoreSourceId) return;
    const fiber = Effect.runFork(
      syncReadingPosition(userId, groupId, restoreSourceId).pipe(
        Effect.ignore,
        Effect.repeat(Schedule.spaced("3 seconds")),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
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
  if (group && source && !openingPosition.ready) {
    return <WorkspaceLoadingShell isMobile={isMobile} />;
  }

  const content =
    !group || !source ? (
      <NoBook group={resolved.group} onUpload={() => setUploadOpen(true)} />
    ) : (
      <Workspace
        group={group}
        groupName={group.displayName}
        groupRef={groupRef}
        groupId={group.groupId}
        source={source}
        file={loaded ?? null}
        storedBookTitle={source.title}
        onTitleParsed={onTitleParsed}
        initialReadingPosition={openingPosition.position}
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
        viewerRole={resolved.role}
        viewer={{ userId: userId ?? "", isOwner: resolved.isOwner }}
        onChangeMemberRole={onChangeMemberRole}
        onDeleteBook={onDeleteBook}
        onUpdateBookMetadata={onUpdateBookMetadata}
        onProfileChange={onProfileChange}
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
