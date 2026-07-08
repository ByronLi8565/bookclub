import type { RosterEntry } from "../../logic/groups/groupClient.ts";
import type { OnlinePeer } from "../../logic/notes/useNoteAgent.ts";
import { Modal } from "../shared/Modal.tsx";

interface Person {
  id: string;
  name: string;
  email: string;
  role: string;
  isOnline: boolean;
}

function mergePeople(members: RosterEntry[], online: OnlinePeer[]): Person[] {
  const onlineIds = new Set(online.map((p) => p.id));
  const byId = new Map<string, Person>();
  for (const m of members) {
    byId.set(m.id, { ...m, isOnline: onlineIds.has(m.id) });
  }

  for (const p of online) {
    if (!byId.has(p.id)) byId.set(p.id, { ...p, email: "", isOnline: true });
  }
  return [...byId.values()].toSorted((a, b) => Number(b.isOnline) - Number(a.isOnline));
}

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
    <Modal title="online now" className="modal--invite" onClose={onClose}>
      <div className="modal-body">
        <div className="invite-people">
          <p className="invite-people-head label">
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
                  <span className="invite-person-name truncate">{p.name}</span>
                  {p.email && <span className="invite-person-email truncate">{p.email}</span>}
                </span>
                <span className="invite-person-role label">{p.isOnline ? p.role : "offline"}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
