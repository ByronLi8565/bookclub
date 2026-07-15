import * as Effect from "effect/Effect";
import { useMemo, useState } from "react";
import { GroupAction, permits } from "../../shared/groupPermissions.ts";
import type { SourceReadingPosition } from "../../shared/types/readingPositions.ts";
import type { SourceRef, SourceSummary } from "../../shared/types/sources.ts";
import type { ClubProfile } from "../../shared/types/profiles.ts";
import {
  renameGroup,
  type GroupRole,
  type GroupSummary,
  type BookMetadataPatch,
  type RosterEntry,
} from "../logic/groups/groupClient.ts";
import { type NoteViewer } from "../logic/notes/permissions.ts";
import { PresenceModal } from "../ui/group/PresenceModal.tsx";
import { InfoScreen } from "../ui/shared/InfoScreen.tsx";
import { spawnToast } from "../ui/shared/toast/toastStore.ts";
import { NotePanel } from "../ui/notes/NotePanel.tsx";
import { Reader } from "../ui/reader/Reader.tsx";
import { WorkspaceHeader } from "../ui/workspace/WorkspaceHeader.tsx";
import { SettingsModal } from "../ui/workspace/SettingsModal.tsx";
import { WorkspaceLayout, type WorkspaceLayoutMode } from "../ui/workspace/WorkspaceLayout.tsx";
import {
  useWorkspaceHotkeys,
  useWorkspaceLayout,
  useWorkspaceReaderFit,
} from "../ui/workspace/useWorkspaceLayout.ts";
import { useReaderNoteSession } from "../ui/workspace/useReaderNoteSession.ts";

export interface WorkspaceProps {
  group: GroupSummary;
  groupName: string;
  groupRef: string;
  groupId: string;
  source: SourceRef;
  file: File | null;
  storedBookTitle: string | null;
  onTitleParsed: (sourceId: string, title: string) => void;
  initialReadingPosition?: SourceReadingPosition | null;
  onReadingPosition?: (sourceId: string, position: SourceReadingPosition) => void;
  onSyncReadingPosition?: (sourceId: string) => Effect.Effect<boolean, unknown>;
  books: SourceSummary[];
  selectedSourceId: string;
  onSelectBook: (sourceId: string) => void;
  onRenameBook: (sourceId: string, title: string) => void;
  onAddBook: () => void;
  members: RosterEntry[];
  viewerRole: GroupRole;
  viewer: NoteViewer;
  onChangeMemberRole: (memberId: string, role: GroupRole) => Promise<boolean>;
  onDeleteBook: (sourceId: string) => Promise<boolean>;
  onUpdateBookMetadata: (sourceId: string, patch: BookMetadataPatch) => Promise<boolean>;
  onProfileChange: (profile: ClubProfile) => void;
}

export function Workspace({
  group,
  groupName,
  groupRef,
  groupId,
  source,
  file,
  storedBookTitle,
  onTitleParsed,
  initialReadingPosition = null,
  onReadingPosition = () => {},
  onSyncReadingPosition = () => Effect.succeed(false),
  books,
  selectedSourceId,
  onSelectBook,
  onRenameBook,
  onAddBook,
  members,
  viewerRole,
  viewer,
  onChangeMemberRole,
  onDeleteBook,
  onUpdateBookMetadata,
  onProfileChange,
}: WorkspaceProps) {
  const sourceId = source.id;
  const canRenameBooks = permits(viewerRole, GroupAction.RenameBook);
  const layout = useWorkspaceLayout();
  const {
    activeModal,
    setActiveModal,
    isMobile,
    pane,
    setPane,
    desktopExpandedPane,
    setDesktopExpandedPane,
    chromeLevel,
    stepChrome,
    finishChromeTransition,
  } = layout;
  const [renamedDisplayName, setRenamedDisplayName] = useState<{
    base: string;
    value: string;
  } | null>(null);
  const displayName = renamedDisplayName?.base === groupName ? renamedDisplayName.value : groupName;
  const memberProfile = useMemo<ClubProfile>(() => {
    const me = members.find((member) => member.id === viewer.userId);
    return {
      id: viewer.userId,
      displayName: me?.name ?? "You",
      ...(me?.avatarImageId ? { avatarImageId: me.avatarImageId } : {}),
    };
  }, [members, viewer.userId]);
  const session = useReaderNoteSession({
    groupId,
    groupRef,
    source,
    file,
    storedBookTitle,
    initialReadingPosition,
    books,
    members,
    viewer,
    layout,
    onTitleParsed,
    onReadingPosition,
    onSelectBook,
  });
  const { view } = session;
  useWorkspaceReaderFit({
    fitToText: view.fitToText ?? null,
    chromeTransitioning: layout.chromeTransitioning,
    desktopExpandedPane,
  });
  useWorkspaceHotkeys({ view, sourceId, onSyncReadingPosition, layout });
  async function onRenameGroup(title: string): Promise<void> {
    const result = await renameGroup(groupRef, title);
    if (result.ok) setRenamedDisplayName({ base: groupName, value: title });
    else spawnToast("Rename failed", "Couldn't rename the club.", { type: "error" });
  }
  const reader = (
    <Reader
      view={view}
      hasFile
      loading={session.readerLoading}
      floatingNote={!isMobile}
      books={books}
      selectedSourceId={selectedSourceId}
      onSelectBook={onSelectBook}
      onRenameBook={canRenameBooks ? onRenameBook : null}
      onAddBook={onAddBook}
      chromeHidden={chromeLevel >= 2}
    />
  );
  const notePanel = <NotePanel {...session.notePanelProps} />;
  const workspaceMode: WorkspaceLayoutMode = isMobile
    ? {
        kind: "mobile",
        pane,
        onPane: setPane,
        selecting: view.selection !== null,
        onAddNote: () => view.commitSelection("note"),
        onHighlight: () => view.commitSelection("highlight"),
        onChromeHiddenChange: (hidden) => stepChrome(hidden ? "hide" : "show"),
      }
    : {
        kind: "desktop",
        expandedPane: desktopExpandedPane,
        onExpandedPaneChange: setDesktopExpandedPane,
      };

  return (
    <div
      className={chromeLevel >= 1 ? "app app--chrome-hidden" : "app"}
      onTransitionEnd={(event) => {
        if (
          event.propertyName === "max-height" &&
          event.target instanceof Element &&
          event.target.matches(".topbar, .reader-bar")
        ) {
          finishChromeTransition();
        }
      }}
    >
      <WorkspaceHeader
        displayName={displayName}
        onRename={(t) => void onRenameGroup(t)}
        onlineCount={session.online.length}
        onShowPeople={() => setActiveModal("group")}
        onShowSettings={() => setActiveModal("settings")}
        onShowInfo={() => setActiveModal("info")}
      />
      <WorkspaceLayout mode={workspaceMode} reader={reader} notes={notePanel} />
      {activeModal === "group" && (
        <PresenceModal
          groupRef={groupRef}
          group={group}
          members={members}
          online={session.online}
          viewerId={viewer.userId}
          viewerRole={viewerRole}
          onChangeMemberRole={onChangeMemberRole}
          onDeleteBook={onDeleteBook}
          onUpdateBookMetadata={onUpdateBookMetadata}
          onClose={() => setActiveModal(null)}
        />
      )}
      {activeModal === "settings" && (
        <SettingsModal
          book={{ groupId, profile: memberProfile, onProfileChange }}
          onClose={() => setActiveModal(null)}
        />
      )}
      {activeModal === "info" && <InfoScreen onClose={() => setActiveModal(null)} />}
    </div>
  );
}
