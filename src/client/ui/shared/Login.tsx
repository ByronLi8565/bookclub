import { useReducer } from "react";
import type { Session } from "../../app/useSession.ts";
import { passkeysSupported } from "../../logic/auth/authClient.ts";
import { Modal } from "./Modal.tsx";

const MESSAGES: Record<string, string> = {
  invalid_email: "That doesn't look like an email.",
  rate_limited: "Too many attempts. Wait a bit and try again.",
  invalid_request: "Enter the code from your email.",
  no_pending: "That code expired. Request a new one.",
  expired: "That code expired. Request a new one.",
  too_many_attempts: "Too many tries. Request a new code.",
  bad_code: "Wrong code. Try again.",
  bad_password: "Wrong password. Try again, or sign in with a code.",
  no_password: "No password set for that account. Sign in with a code.",
  no_passkeys: "No passkeys registered for that account.",
  passkey_cancelled: "Passkey sign-in was cancelled.",
  verification_failed: "Passkey sign-in failed. Try again.",
  challenge_expired: "That took too long. Try again.",
  unknown_credential: "That passkey isn't recognized.",
};

const message = (error: string): string => MESSAGES[error] ?? "Something went wrong. Try again.";

type Step = "email" | "code" | "done";

interface LoginModalState {
  step: Step;
  email: string;
  password: string;
  code: string;
  error: string | null;
  busy: boolean;
}

type LoginModalAction =
  | { type: "email"; email: string }
  | { type: "password"; password: string }
  | { type: "code"; code: string }
  | { type: "submit" }
  | { type: "error"; error: string }
  | { type: "codeSent" }
  | { type: "done" };

const initialLoginModalState: LoginModalState = {
  step: "email",
  email: "",
  password: "",
  code: "",
  error: null,
  busy: false,
};

function loginModalReducer(state: LoginModalState, action: LoginModalAction): LoginModalState {
  switch (action.type) {
    case "email":
      return { ...state, email: action.email };
    case "password":
      return { ...state, password: action.password };
    case "code":
      return { ...state, code: action.code };
    case "submit":
      return { ...state, busy: true, error: null };
    case "error":
      return { ...state, busy: false, error: action.error };
    case "codeSent":
      return { ...state, step: "code", busy: false };
    case "done":
      return { ...state, step: "done", busy: false };
  }
}

export function Login({
  session,
  onSignIn,
}: {
  session: Session;
  onSignIn: () => void;
}): React.ReactElement {
  if (session.status === "authed" && session.user) {
    return (
      <div className="login login--authed">
        <span className="login-email">{session.user.email}</span>
        <button
          type="button"
          className="login-link plain-button"
          onClick={() => void session.signOut()}
          title="Sign out"
        >
          sign out
        </button>
      </div>
    );
  }

  return (
    <button type="button" className="login-signin" onClick={onSignIn} title="Sign in">
      sign in
    </button>
  );
}

export function LoginModal({
  session,
  onClose,
}: {
  session: Session;
  onClose: () => void;
}): React.ReactElement {
  const [state, dispatch] = useReducer(loginModalReducer, initialLoginModalState);
  const { step, email, password, code, error, busy } = state;
  const canUsePasskeys = passkeysSupported();

  function finish(): void {
    dispatch({ type: "done" });
    setTimeout(onClose, 1200);
  }

  // The email step's primary action: if a password was typed, try it; otherwise
  // fall back to emailing a code. A wrong/absent password does not lock the user
  // out — they can clear the field and request a code instead.
  async function onEmailSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    dispatch({ type: "submit" });

    if (password !== "") {
      const result = await session.loginWithPassword(email, password);
      if (result.ok) {
        finish();
        return;
      }
      dispatch({ type: "error", error: message(result.error) });
      return;
    }

    const result = await session.startLogin(email);
    if (!result.ok) {
      dispatch({ type: "error", error: message(result.error) });
      return;
    }
    if (result.devSignedIn) {
      finish();
      return;
    }
    dispatch({ type: "codeSent" });
  }

  async function onPasskey(): Promise<void> {
    dispatch({ type: "submit" });
    const result = await session.passkeyLogin(email);
    if (!result.ok) {
      dispatch({ type: "error", error: message(result.error) });
      return;
    }
    finish();
  }

  async function onVerify(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    dispatch({ type: "submit" });
    const result = await session.verify(email, code);
    if (!result.ok) {
      dispatch({ type: "error", error: message(result.error) });
      return;
    }

    dispatch({ type: "done" });
    setTimeout(onClose, 1200);
  }

  return (
    <Modal title="sign in" onClose={onClose}>
      <div className="modal-body">
        {step === "done" ? (
          <p className="modal-success">✓ Sign in successful</p>
        ) : step === "email" ? (
          <form onSubmit={(e) => void onEmailSubmit(e)}>
            <input
              type="email"
              autoComplete="username webauthn"
              aria-label="Email address"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => dispatch({ type: "email", email: e.target.value })}
            />
            <input
              type="password"
              autoComplete="current-password"
              aria-label="Password (optional)"
              placeholder="password (optional)"
              value={password}
              onChange={(e) => dispatch({ type: "password", password: e.target.value })}
            />
            <button
              type="submit"
              className="primary"
              disabled={busy || email === ""}
              title={password === "" ? "Send a sign-in code" : "Sign in with password"}
            >
              {password === "" ? "send code" : "sign in"}
            </button>
            {canUsePasskeys && (
              <button
                type="button"
                className="login-passkey plain-button"
                disabled={busy || email === ""}
                onClick={() => void onPasskey()}
                title="Sign in with a passkey"
              >
                use a passkey
              </button>
            )}
          </form>
        ) : (
          <form onSubmit={(e) => void onVerify(e)}>
            <p className="modal-note">Enter the code we sent to {email}.</p>
            <input
              type="text"
              inputMode="numeric"
              aria-label="Verification code"
              placeholder="6-digit code"
              value={code}
              onChange={(e) => dispatch({ type: "code", code: e.target.value })}
            />
            <button
              type="submit"
              className="primary"
              disabled={busy || code === ""}
              title="Verify code"
            >
              verify
            </button>
          </form>
        )}
        {error && <p className="login-error">{error}</p>}
      </div>
    </Modal>
  );
}
