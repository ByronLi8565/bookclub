import { Loading } from "../shared/Loading.tsx";
import { MobilePager } from "../shared/MobilePager.tsx";
import { SplitPane } from "../shared/SplitPane.tsx";

export function WorkspaceLoadingShell({ isMobile }: { isMobile: boolean }): React.ReactElement {
  const reader = (
    <div className="reader">
      <div className="reader-bar">
        <span className="reader-title" />
        <span className="spacer" />
      </div>
      <div className="reader-stage">
        <div className="reader-surface">
          <Loading className="loading--reader" />
        </div>
      </div>
    </div>
  );
  const notes = (
    <aside className="note-panel">
      <h2>Notes</h2>
      <Loading className="loading--note-panel" />
    </aside>
  );

  return (
    <div className="app">
      <header className="topbar">
        <a className="topbar-home" href="/" aria-label="back to your clubs">
          ‹
        </a>
        <span className="presence-indicator" aria-hidden="true">
          <span className="presence-count">0</span>
          <span className="presence-dot" />
        </span>
        <span className="sync-badge sync-badge--syncing">syncing</span>
      </header>
      {isMobile ? (
        <MobilePager
          pane="reader"
          onPane={() => {}}
          reader={reader}
          notes={notes}
          selecting={false}
          onAddNote={() => {}}
        />
      ) : (
        <SplitPane left={reader} right={notes} />
      )}
    </div>
  );
}
