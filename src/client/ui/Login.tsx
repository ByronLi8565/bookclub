import { useState } from "react";
import type { Session } from "../auth/useSession.ts";

// Friendly copy for the server's error codes.
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

// The sign-in control in the top-right of the home page. Authed: the user's
// email with a sign-out affordance. Anonymous: a "sign in with email" link that
// asks the page to open the login modal (owned by Home so other controls can
// open it too).
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
        <button type="button" className="login-link" onClick={() => void session.signOut()}>
          sign out
        </button>
      </div>
    );
  }

  return (
    <button type="button" className="login-signin" onClick={onSignIn}>
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
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSendCode(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await session.startLogin(email);
    setBusy(false);
    if (result.ok) setStep("code");
    else setError(message(result.error));
  }

  async function onVerify(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await session.verify(email, code);
    setBusy(false);
    if (!result.ok) {
      setError(message(result.error));
      return;
    }
    // Show success, then auto-close (session is already authed underneath).
    setStep("done");
    setTimeout(onClose, 1200);
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="sign in with email"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <strong>sign in with email</strong>
          <button type="button" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          {step === "done" ? (
            <p className="modal-success">✓ Sign in successful</p>
          ) : step === "email" ? (
            <form onSubmit={(e) => void onSendCode(e)}>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
              <button type="submit" className="primary" disabled={busy || email === ""}>
                send code
              </button>
            </form>
          ) : (
            <form onSubmit={(e) => void onVerify(e)}>
              <p className="modal-note">Enter the code we sent to {email}.</p>
              <input
                type="text"
                inputMode="numeric"
                placeholder="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
              />
              <button type="submit" className="primary" disabled={busy || code === ""}>
                verify
              </button>
            </form>
          )}
          {error && <p className="login-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
