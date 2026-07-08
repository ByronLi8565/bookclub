import { useEffect, useReducer } from "react";
import type { PasskeyInfo } from "../../../shared/types/passkeys.ts";
import {
  listPasskeys,
  passkeysSupported,
  registerPasskey,
  removePasskey,
  removePassword,
  setPassword,
} from "../../logic/auth/authClient.ts";
import { spawnToast } from "./toast/toastStore.ts";

const MESSAGES: Record<string, string> = {
  weak_password: "Password must be at least 8 characters.",
  bad_current: "Current password is incorrect.",
  passkey_cancelled: "Passkey setup was cancelled.",
  verification_failed: "Couldn't register that passkey. Try again.",
  challenge_expired: "That took too long. Try again.",
  unauthenticated: "Please sign in again.",
};
const msg = (error: string): string => MESSAGES[error] ?? "Something went wrong. Try again.";

interface State {
  passkeys: PasskeyInfo[];
  loaded: boolean;
  hasPassword: boolean;
  label: string;
  current: string;
  next: string;
  busy: boolean;
}

type Action =
  | { type: "passkeys"; passkeys: PasskeyInfo[] }
  | { type: "hasPassword"; value: boolean }
  | { type: "field"; key: "label" | "current" | "next"; value: string }
  | { type: "busy"; value: boolean };

const initialState: State = {
  passkeys: [],
  loaded: false,
  hasPassword: false,
  label: "",
  current: "",
  next: "",
  busy: false,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "passkeys":
      return { ...state, passkeys: action.passkeys, loaded: true };
    case "hasPassword":
      return { ...state, hasPassword: action.value };
    case "field":
      return { ...state, [action.key]: action.value };
    case "busy":
      return { ...state, busy: action.value };
  }
}

export function AccountSettings(): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { passkeys, loaded, hasPassword, label, current, next, busy } = state;
  const canUsePasskeys = passkeysSupported();

  async function refreshPasskeys(): Promise<void> {
    const result = await listPasskeys();
    if (result.ok) dispatch({ type: "passkeys", passkeys: result.value });
  }

  useEffect(() => {
    void refreshPasskeys();
  }, []);

  async function onAddPasskey(): Promise<void> {
    dispatch({ type: "busy", value: true });
    const result = await registerPasskey(label.trim() || "Passkey");
    dispatch({ type: "busy", value: false });
    if (!result.ok) {
      spawnToast("Passkey", msg(result.error), { type: "error" });
      return;
    }
    dispatch({ type: "field", key: "label", value: "" });
    spawnToast("Passkey added", "You can now sign in with this passkey.", { type: "info" });
    void refreshPasskeys();
  }

  async function onRemovePasskey(id: string): Promise<void> {
    const result = await removePasskey(id);
    if (!result.ok) {
      spawnToast("Passkey", msg(result.error), { type: "error" });
      return;
    }
    void refreshPasskeys();
  }

  async function onSavePassword(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    dispatch({ type: "busy", value: true });
    const result = await setPassword(next, hasPassword ? current : undefined);
    dispatch({ type: "busy", value: false });
    if (!result.ok) {
      spawnToast("Password", msg(result.error), { type: "error" });
      return;
    }
    dispatch({ type: "field", key: "next", value: "" });
    dispatch({ type: "field", key: "current", value: "" });
    dispatch({ type: "hasPassword", value: true });
    spawnToast("Password saved", "You can now sign in with your password.", { type: "info" });
  }

  async function onRemovePassword(): Promise<void> {
    dispatch({ type: "busy", value: true });
    const result = await removePassword(current);
    dispatch({ type: "busy", value: false });
    if (!result.ok) {
      spawnToast("Password", msg(result.error), { type: "error" });
      return;
    }
    dispatch({ type: "field", key: "current", value: "" });
    dispatch({ type: "hasPassword", value: false });
    spawnToast("Password removed", "You'll sign in with a code or passkey.", { type: "info" });
  }

  return (
    <>
      <section className="settings-item settings-item--stacked">
        <div className="settings-item-text">
          <h2 className="settings-item-head">Passkeys</h2>
          <p className="settings-item-desc">Sign in with Face ID, Touch ID, or a security key.</p>
        </div>
        {canUsePasskeys ? (
          <>
            {loaded && passkeys.length > 0 && (
              <ul className="account-passkey-list">
                {passkeys.map((pk) => (
                  <li key={pk.id} className="account-passkey">
                    <span className="account-passkey-label truncate">{pk.label}</span>
                    <button
                      type="button"
                      className="login-link plain-button"
                      onClick={() => void onRemovePasskey(pk.id)}
                      title="Remove this passkey"
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="account-passkey-add">
              <input
                type="text"
                aria-label="Passkey name"
                placeholder="passkey name (optional)"
                value={label}
                onChange={(e) => dispatch({ type: "field", key: "label", value: e.target.value })}
              />
              <button
                type="button"
                className="settings-action"
                disabled={busy}
                onClick={() => void onAddPasskey()}
                title="Add a passkey"
              >
                add passkey
              </button>
            </div>
          </>
        ) : (
          <p className="settings-item-desc">This browser doesn&apos;t support passkeys.</p>
        )}
      </section>

      <section className="settings-item settings-item--stacked">
        <div className="settings-item-text">
          <h2 className="settings-item-head">Password</h2>
          <p className="settings-item-desc">
            {hasPassword
              ? "A password is set. Enter it at sign-in to skip the email code."
              : "Set an optional password to sign in without an email code."}
          </p>
        </div>
        <form className="account-password-form" onSubmit={(e) => void onSavePassword(e)}>
          {hasPassword && (
            <input
              type="password"
              autoComplete="current-password"
              aria-label="Current password"
              placeholder="current password"
              value={current}
              onChange={(e) => dispatch({ type: "field", key: "current", value: e.target.value })}
            />
          )}
          <input
            type="password"
            autoComplete="new-password"
            aria-label="New password"
            placeholder={hasPassword ? "new password" : "password"}
            value={next}
            onChange={(e) => dispatch({ type: "field", key: "next", value: e.target.value })}
          />
          <button
            type="submit"
            className="settings-action"
            disabled={busy || next === "" || (hasPassword && current === "")}
            title={hasPassword ? "Change password" : "Set password"}
          >
            {hasPassword ? "change" : "set password"}
          </button>
          {hasPassword && (
            <button
              type="button"
              className="login-link plain-button"
              disabled={busy || current === ""}
              onClick={() => void onRemovePassword()}
              title="Remove password"
            >
              remove
            </button>
          )}
        </form>
      </section>
    </>
  );
}
