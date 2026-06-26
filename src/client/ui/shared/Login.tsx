import { useReducer } from "react";
import type { Session } from "../../app/useSession.ts";
import { Modal } from "./Modal.tsx";

const MESSAGES: Record<string, string> = {
  invalid_email: "That doesn't look like an email.",
  rate_limited: "Too many codes requested. Wait a bit and try again.",
  invalid_request: "Enter the code from your email.",
  no_pending: "That code expired. Request a new one.",
  expired: "That code expired. Request a new one.",
  too_many_attempts: "Too many tries. Request a new code.",
  bad_code: "Wrong code. Try again.",
};

const message = (error: string): string => MESSAGES[error] ?? "Something went wrong. Try again.";

type Step = "email" | "code" | "done";

interface LoginModalState {
  step: Step;
  email: string;
  code: string;
  error: string | null;
  busy: boolean;
}

type LoginModalAction =
  | { type: "email"; email: string }
  | { type: "code"; code: string }
  | { type: "submit" }
  | { type: "error"; error: string }
  | { type: "codeSent" }
  | { type: "done" };

const initialLoginModalState: LoginModalState = {
  step: "email",
  email: "",
  code: "",
  error: null,
  busy: false,
};

function loginModalReducer(state: LoginModalState, action: LoginModalAction): LoginModalState {
  switch (action.type) {
    case "email":
      return { ...state, email: action.email };
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
  const { step, email, code, error, busy } = state;

  async function onSendCode(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    dispatch({ type: "submit" });
    const result = await session.startLogin(email);
    if (!result.ok) {
      dispatch({ type: "error", error: message(result.error) });
      return;
    }

    if (result.devSignedIn) {
      dispatch({ type: "done" });
      setTimeout(onClose, 1200);
      return;
    }
    dispatch({ type: "codeSent" });
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
    <Modal title="sign in with email" onClose={onClose}>
      <div className="modal-body">
        {step === "done" ? (
          <p className="modal-success">✓ Sign in successful</p>
        ) : step === "email" ? (
          <form onSubmit={(e) => void onSendCode(e)}>
            <input
              type="email"
              aria-label="Email address"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => dispatch({ type: "email", email: e.target.value })}
            />
            <button
              type="submit"
              className="primary"
              disabled={busy || email === ""}
              title="Send code"
            >
              send code
            </button>
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
