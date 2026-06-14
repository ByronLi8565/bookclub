import { useEffect, useState } from "react";
import { fetchGroup, getInviteLink, inviteToGroup, type RosterEntry } from "../groups/api.ts";
import { spawnToast } from "./toast.tsx";

// Owner-only invite dialog: send an email invite and/or share the reusable open
// link (regenerate to revoke the old one), plus the current people-with-access
// list. Opened from Home and the workspace topbar.
export function InviteModal({
  name,
  displayName,
  onClose,
}: {
  name: string;
  displayName: string;
  onClose: () => void;
}): React.ReactElement {
  const [link, setLink] = useState<string | null>(null);
  const [members, setMembers] = useState<RosterEntry[]>([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getInviteLink(name).then((r) => {
      if (!cancelled && r.ok) setLink(r.value.link);
    });
    void fetchGroup(name).then((g) => {
      if (!cancelled && g) setMembers(g.members);
    });
    return () => {
      cancelled = true;
    };
  }, [name]);

  async function onSendEmail(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    const result = await inviteToGroup(name, email);
    setBusy(false);
    if (result.ok) {
      spawnToast("Invite sent", `Invited ${email}.`, { type: "info" });
      setEmail("");
    } else {
      spawnToast("Invite failed", "Couldn't send that invite.", { type: "error" });
    }
  }

  async function onCopy(): Promise<void> {
    if (!link) return;
    await navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function onRotate(): Promise<void> {
    setBusy(true);
    const result = await getInviteLink(name, true);
    setBusy(false);
    if (result.ok) setLink(result.value.link);
    else spawnToast("Failed", "Couldn't regenerate the link.", { type: "error" });
  }

  // Show the link without its protocol prefix (it stays full in the clipboard).
  const shownLink = link ? link.replace(/^https?:\/\//u, "") : "generating…";

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal modal--invite"
        role="dialog"
        aria-modal="true"
        aria-label={`invite to ${displayName}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <strong>invite to {displayName}</strong>
          <button type="button" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <form onSubmit={(e) => void onSendEmail(e)}>
            <input
              type="email"
              placeholder="invite by email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit" className="primary" disabled={busy || email === ""}>
              send invite
            </button>
          </form>

          <p className="modal-note">Or share a link anyone can use to join:</p>
          <div className="invite-link">
            <input type="text" readOnly value={shownLink} aria-label="invite link" />
            <button
              type="button"
              className="invite-icon"
              onClick={() => void onCopy()}
              disabled={!link}
              aria-label="copy link"
              title={copied ? "Copied" : "Copy link"}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
            <button
              type="button"
              className="invite-icon"
              onClick={() => void onRotate()}
              disabled={busy}
              aria-label="regenerate link"
              title="Regenerate link"
            >
              <RotateIcon />
            </button>
          </div>

          <div className="invite-people">
            <p className="invite-people-head">People with access</p>
            <ul className="invite-people-list">
              {members.map((m) => (
                <li key={m.id}>
                  <span className="invite-avatar">{m.name.slice(0, 1).toUpperCase()}</span>
                  <span className="invite-person-name">{m.name}</span>
                  <span className="invite-person-role">{m.role}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

const ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function CopyIcon(): React.ReactElement {
  return (
    <svg {...ICON_PROPS} aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="1" />
      <path d="M5 15V5a1 1 0 0 1 1-1h10" />
    </svg>
  );
}

function RotateIcon(): React.ReactElement {
  return (
    <svg {...ICON_PROPS} aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

function CheckIcon(): React.ReactElement {
  return (
    <svg {...ICON_PROPS} aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
