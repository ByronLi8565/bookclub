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

type Step = "idle" | "email" | "code";

// The sign-in control in the top-right of the home page. Anonymous: a "sign in
// with email" link that opens an inline email -> code flow. Authed: the user's
// email with a sign-out affordance.
export function Login({ session }: { session: Session }): React.ReactElement {
  const [step, setStep] = useState<Step>("idle");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  if (step === "idle") {
    return (
      <button type="button" className="login-link" onClick={() => setStep("email")}>
        sign in with email
      </button>
    );
  }

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
    // On success the parent re-renders into the authed branch.
    if (!result.ok) setError(message(result.error));
  }

  return (
    <div className="login login--form">
      {step === "email" ? (
        <form onSubmit={(e) => void onSendCode(e)}>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <button type="submit" disabled={busy || email === ""}>
            send code
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => void onVerify(e)}>
          <input
            type="text"
            inputMode="numeric"
            placeholder="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
          <button type="submit" disabled={busy || code === ""}>
            verify
          </button>
        </form>
      )}
      {error && <p className="login-error">{error}</p>}
    </div>
  );
}
