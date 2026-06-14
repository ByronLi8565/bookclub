import type { RosterEntry } from "../../groups/api.ts";
import type { OnlinePeer } from "../../notes/agent.ts";

interface Person {
  id: string;
  name: string;
  email: string;
  role: string;
  isOnline: boolean;
}

// Merge the full roster (everyone who's ever joined) with the live online set,
// online first, so we can show present members as online and the rest as offline.
function mergePeople(members: RosterEntry[], online: OnlinePeer[]): Person[] {
  const onlineIds = new Set(online.map((p) => p.id));
  const byId = new Map<string, Person>();
  for (const m of members) {
    byId.set(m.id, { ...m, isOnline: onlineIds.has(m.id) });
  }
  // Include anyone online who isn't in the roster snapshot (e.g. just joined).
  for (const p of online) {
    if (!byId.has(p.id)) byId.set(p.id, { ...p, email: "", isOnline: true });
  }
  return [...byId.values()].toSorted((a, b) => Number(b.isOnline) - Number(a.isOnline));
}

// A read-only dialog listing the club's members, marking who's currently online.
export function PresenceModal({
  members,
  online,
  onClose,
}: {
  members: RosterEntry[];
  online: OnlinePeer[];
  onClose: () => void;
}): React.ReactElement {
  const people = mergePeople(members, online);
  const onlineCount = people.filter((p) => p.isOnline).length;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal modal--invite"
        role="dialog"
        aria-modal="true"
        aria-label="who's online"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <strong>online now</strong>
          <button type="button" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="invite-people">
            <p className="invite-people-head">
              {onlineCount} of {people.length} online
            </p>
            <ul className="invite-people-list">
              {people.map((p) => (
                <li key={p.id} className={p.isOnline ? "" : "person--offline"}>
                  <span className="invite-avatar">
                    {p.name.slice(0, 1).toUpperCase()}
                    <span className={`presence-pip presence-pip--${p.isOnline ? "on" : "off"}`} />
                  </span>
                  <span className="invite-person-text">
                    <span className="invite-person-name">{p.name}</span>
                    {p.email && <span className="invite-person-email">{p.email}</span>}
                  </span>
                  <span className="invite-person-role">{p.isOnline ? p.role : "offline"}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
