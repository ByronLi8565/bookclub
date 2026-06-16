import { useEffect, useState } from "react";
import { fetchGroup, getInviteLink, inviteToGroup, type RosterEntry } from "../../groups/api.ts";
import { Loading } from "../shared/Loading.tsx";
import { spawnToast } from "../shared/toast/store.ts";

export function InviteModal({
  groupRef,
  displayName,
  onClose,
}: {
  groupRef: string;
  displayName: string;
  onClose: () => void;
}): React.ReactElement {
  const [link, setLink] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(true);
  const [members, setMembers] = useState<RosterEntry[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLink(null);
    setLinkLoading(true);
    setMembers([]);
    setMembersLoading(true);
    void getInviteLink(groupRef).then((r) => {
      if (cancelled) return;
      if (r.ok) setLink(r.value.link);
      setLinkLoading(false);
    });
    void fetchGroup(groupRef).then((g) => {
      if (cancelled) return;
      if (g) setMembers(g.members);
      setMembersLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [groupRef]);

  async function onSendEmail(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    const result = await inviteToGroup(groupRef, email);
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
    const result = await getInviteLink(groupRef, true);
    setBusy(false);
    if (result.ok) setLink(result.value.link);
    else spawnToast("Failed", "Couldn't regenerate the link.", { type: "error" });
  }

  const shownLink = link ? link.replace(/^https?:\/\//u, "") : "";

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
          <button type="button" onClick={onClose} aria-label="close" title="Close">
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
            <button
              type="submit"
              className="primary"
              disabled={busy || email === ""}
              title="Send invite"
            >
              send invite
            </button>
          </form>

          <div className="invite-people">
            <p className="invite-people-head">People with access</p>
            {membersLoading ? (
              <Loading className="loading--invite-people" />
            ) : (
              <ul className="invite-people-list">
                {members.map((m) => (
                  <li key={m.id}>
                    <span className="invite-avatar">{m.name.slice(0, 1).toUpperCase()}</span>
                    <span className="invite-person-name truncate">{m.name}</span>
                    <span className="invite-person-role">{m.role}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="invite-share">
            <p className="modal-note">Or share a link anyone can use to join:</p>
            {linkLoading ? (
              <Loading className="loading--invite-link" />
            ) : (
              <div className="invite-link">
                <input type="text" readOnly value={shownLink} aria-label="invite link" />
                <button
                  type="button"
                  className="invite-icon icon-button"
                  onClick={() => void onCopy()}
                  disabled={!link}
                  aria-label="copy link"
                  title={copied ? "Copied" : "Copy link"}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </button>
                <button
                  type="button"
                  className="invite-icon icon-button"
                  onClick={() => void onRotate()}
                  disabled={busy}
                  aria-label="regenerate link"
                  title="Regenerate link"
                >
                  <RotateIcon />
                </button>
              </div>
            )}
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
