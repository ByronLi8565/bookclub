import { useState } from "react";

type SyncStatus = "syncing" | "online" | "offline";

// The workspace topbar: back link, the club title (double-click to rename, any
// member), an owner-only invite button, and the live sync badge.
export function WorkspaceHeader({
  displayName,
  onRename,
  canInvite,
  onInvite,
  syncStatus,
  onSyncClick,
}: {
  displayName: string;
  onRename: (title: string) => void;
  canInvite: boolean;
  onInvite: () => void;
  syncStatus: SyncStatus;
  onSyncClick: () => void;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayName);

  function save(): void {
    const title = draft.trim();
    if (title !== "" && title !== displayName) onRename(title);
    setEditing(false);
  }

  return (
    <header className="topbar">
      <a className="topbar-home" href="/" aria-label="back to your clubs">
        ‹ clubs
      </a>
      {editing ? (
        <input
          className="topbar-title-edit"
          value={draft}
          autoFocus
          aria-label="club name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setDraft(displayName);
              setEditing(false);
            }
          }}
        />
      ) : (
        <h1
          title="Double-click to rename the club"
          onDoubleClick={() => {
            setDraft(displayName);
            setEditing(true);
          }}
        >
          {displayName}
        </h1>
      )}
      {canInvite && (
        <button type="button" className="topbar-invite" onClick={onInvite}>
          invite
        </button>
      )}
      <button
        type="button"
        className={`sync-badge sync-badge--${syncStatus}`}
        onClick={onSyncClick}
        aria-label="show sync status"
      >
        {syncStatus}
      </button>
    </header>
  );
}
