// The sign-in surface speaks in API error codes; a reader needs a sentence. Both
// the React modal and the Foldkit one read this table so the two never drift.
const MESSAGES = new Map([
  ["invalid_email", "That doesn't look like an email."],
  ["rate_limited", "Too many attempts. Wait a bit and try again."],
  ["invalid_request", "Enter the code from your email."],
  ["no_pending", "That code expired. Request a new one."],
  ["expired", "That code expired. Request a new one."],
  ["too_many_attempts", "Too many tries. Request a new code."],
  ["bad_code", "Wrong code. Try again."],
  ["bad_password", "Wrong password. Try again, or sign in with a code."],
  ["no_password", "No password set for that account. Sign in with a code."],
  ["no_passkeys", "No passkeys registered for that account."],
  ["passkey_cancelled", "Passkey sign-in was cancelled."],
  ["verification_failed", "Passkey sign-in failed. Try again."],
  ["challenge_expired", "That took too long. Try again."],
  ["unknown_credential", "That passkey isn't recognized."],
]);

export const loginErrorMessage = (error: string): string =>
  MESSAGES.get(error) ?? "Something went wrong. Try again.";
