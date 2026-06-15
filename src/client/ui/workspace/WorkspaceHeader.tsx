import { useState } from "react";
import settingsIcon from "@assets/settings.svg";
import { RenamableText } from "../shared/RenamableText.tsx";
import { SettingsModal } from "./SettingsModal.tsx";

type BookRef = { sourceId: string; name: string };

type SyncStatus = "syncing" | "online" | "offline";


export function WorkspaceHeader({
  displayName,
  onRename,
  canInvite,
  onInvite,
  onlineCount,
  onShowPresence,
  syncStatus,
  onSyncClick,
  book,
}: {
  displayName: string;
  onRename: (title: string) => void;
  canInvite: boolean;
  onInvite: () => void;
  onlineCount: number;
  onShowPresence: () => void;
  syncStatus: SyncStatus;
  onSyncClick: () => void;
  book: BookRef;
}): React.ReactElement {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <header className="topbar">
      <a className="topbar-home" href="/" aria-label="back to your clubs">
        ‹
      </a>
      <RenamableText
        as="h1"
        value={displayName}
        onRename={onRename}
        title="Double-click to rename the club"
        ariaLabel="club name"
        inputClassName="topbar-title-edit"
      />
      {canInvite && (
        <button type="button" className="topbar-invite" onClick={onInvite}>
          invite
        </button>
      )}
      <button
        type="button"
        className="presence-indicator"
        onClick={onShowPresence}
        aria-label={`${onlineCount} online — show who's online`}
      >
        <span className="presence-count">{onlineCount}</span>
        <span className="presence-dot" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`sync-badge sync-badge--${syncStatus}`}
        onClick={onSyncClick}
        aria-label="show sync status"
      >
        {syncStatus}
      </button>
      <button
        type="button"
        className="settings-button icon-button"
        onClick={() => setSettingsOpen(true)}
        aria-label="settings"
      >
        <img src={settingsIcon} alt="" aria-hidden="true" />
      </button>
      {settingsOpen && <SettingsModal book={book} onClose={() => setSettingsOpen(false)} />}
    </header>
  );
}
