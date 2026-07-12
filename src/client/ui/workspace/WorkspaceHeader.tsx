import settingsIcon from "@assets/settings.svg";
import { RenamableText } from "../shared/RenamableText.tsx";

export function WorkspaceHeader({
  displayName,
  onRename,
  onlineCount,
  onShowPeople,
  onShowSettings,
  onShowInfo,
}: {
  displayName: string;
  onRename: (title: string) => void;
  onlineCount: number;
  onShowPeople: () => void;
  onShowSettings: () => void;
  onShowInfo: () => void;
}): React.ReactElement {
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
      <button
        type="button"
        className="presence-indicator"
        onClick={onShowPeople}
        aria-label={`${onlineCount} people online — show group`}
        title="Show group"
      >
        <span className="presence-count">{onlineCount}</span>
        <span className="presence-dot" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="settings-button icon-button"
        onClick={onShowSettings}
        aria-label="settings"
        title="Settings"
      >
        <img src={settingsIcon} alt="" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="workspace-info-button"
        aria-label="open info"
        title="About & release log"
        onClick={onShowInfo}
      >
        i
      </button>
    </header>
  );
}
