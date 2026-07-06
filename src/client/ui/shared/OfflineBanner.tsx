import { useOnline } from "../../logic/net/online.ts";

// Global, unobtrusive strip shown whenever the browser reports no connection.
// Reassures the user that local-first features (reading, note-taking) keep
// working and will sync on reconnect.
export function OfflineBanner(): React.ReactElement | null {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="offline-banner" role="status" aria-live="polite">
      You&apos;re offline — you can keep reading and taking notes; changes sync when you reconnect.
    </div>
  );
}
