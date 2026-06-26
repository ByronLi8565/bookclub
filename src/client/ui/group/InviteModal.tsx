import { useEffect, useReducer, useRef } from "react";
import { fetchGroup, getInviteLink, inviteToGroup, type RosterEntry } from "../../groups/api.ts";
import { Loading } from "../shared/Loading.tsx";
import { Modal } from "../shared/Modal.tsx";
import { spawnToast } from "../shared/toast/toastStore.ts";

interface InviteState {
  link: string | null;
  linkLoading: boolean;
  members: RosterEntry[];
  membersLoading: boolean;
  email: string;
  busy: boolean;
  copied: boolean;
}

type InviteAction =
  | { type: "reset" }
  | { type: "linkLoaded"; link: string | null }
  | { type: "membersLoaded"; members: RosterEntry[] }
  | { type: "email"; email: string }
  | { type: "busy"; busy: boolean }
  | { type: "sent" }
  | { type: "copied"; copied: boolean };

const initialInviteState: InviteState = {
  link: null,
  linkLoading: true,
  members: [],
  membersLoading: true,
  email: "",
  busy: false,
  copied: false,
};

function inviteReducer(state: InviteState, action: InviteAction): InviteState {
  switch (action.type) {
    case "reset":
      return initialInviteState;
    case "linkLoaded":
      return { ...state, link: action.link, linkLoading: false, busy: false };
    case "membersLoaded":
      return { ...state, members: action.members, membersLoading: false };
    case "email":
      return { ...state, email: action.email };
    case "busy":
      return { ...state, busy: action.busy };
    case "sent":
      return { ...state, email: "", busy: false };
    case "copied":
      return { ...state, copied: action.copied };
  }
}

export function InviteModal({
  groupRef,
  displayName,
  onClose,
}: {
  groupRef: string;
  displayName: string;
  onClose: () => void;
}): React.ReactElement {
  const [state, dispatch] = useReducer(inviteReducer, initialInviteState);
  const loadedGroupRef = useRef(groupRef);
  const { link, linkLoading, members, membersLoading, email, busy, copied } = state;

  if (loadedGroupRef.current !== groupRef) {
    loadedGroupRef.current = groupRef;
    dispatch({ type: "reset" });
  }

  useEffect(() => {
    let cancelled = false;
    void getInviteLink(groupRef).then((r) => {
      if (cancelled) return;
      dispatch({ type: "linkLoaded", link: r.ok ? r.value.link : null });
    });
    void fetchGroup(groupRef).then((g) => {
      if (cancelled) return;
      dispatch({ type: "membersLoaded", members: g?.members ?? [] });
    });
    return () => {
      cancelled = true;
    };
  }, [groupRef]);

  async function onSendEmail(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    dispatch({ type: "busy", busy: true });
    const result = await inviteToGroup(groupRef, email);
    if (result.ok) {
      spawnToast("Invite sent", `Invited ${email}.`, { type: "info" });
      dispatch({ type: "sent" });
    } else {
      dispatch({ type: "busy", busy: false });
      spawnToast("Invite failed", "Couldn't send that invite.", { type: "error" });
    }
  }

  async function onCopy(): Promise<void> {
    if (!link) return;
    await navigator.clipboard.writeText(link).catch(() => {});
    dispatch({ type: "copied", copied: true });
    setTimeout(() => dispatch({ type: "copied", copied: false }), 1500);
  }

  async function onRotate(): Promise<void> {
    dispatch({ type: "busy", busy: true });
    const result = await getInviteLink(groupRef, true);
    if (result.ok) {
      dispatch({ type: "linkLoaded", link: result.value.link });
    } else {
      dispatch({ type: "busy", busy: false });
      spawnToast("Failed", "Couldn't regenerate the link.", { type: "error" });
    }
  }

  const shownLink = link ? link.replace(/^https?:\/\//u, "") : "";

  return (
    <Modal title={`invite to ${displayName}`} className="modal--invite" onClose={onClose}>
      <div className="modal-body">
        <form onSubmit={(e) => void onSendEmail(e)}>
          <input
            type="email"
            aria-label="Invitee email"
            placeholder="invite by email"
            value={email}
            onChange={(e) => dispatch({ type: "email", email: e.target.value })}
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
    </Modal>
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
