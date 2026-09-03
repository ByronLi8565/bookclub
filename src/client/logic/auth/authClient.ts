import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { parseHttpError } from "../../http.ts";
import { apiFetch } from "../net/api.ts";
import * as Schema from "effect/Schema";
import { decode } from "../../../shared/schema.ts";

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };

// The contract's own `PublicUser` lives beside the HttpApi schemas, and importing
// it here pulls the whole httpapi module into the React bundle for four fields.
const SessionEnvelope = Schema.Struct({
  user: Schema.Struct({
    id: Schema.String,
    email: Schema.String,
    name: Schema.String,
    avatarImageId: Schema.optionalKey(Schema.String),
  }),
  token: Schema.optionalKey(Schema.String),
});
export type SessionEnvelope = typeof SessionEnvelope.Type;

const json = { "Content-Type": "application/json" };
// Registration ceremony: fetch creation options, prompt the authenticator, then
// verify. A thrown ceremony means the user dismissed the prompt.
export async function registerPasskey(label: string): Promise<Result> {
  const optionsRes = await apiFetch("/auth/passkey/register/options", { method: "POST" });
  if (!optionsRes.ok) return { ok: false, error: await parseHttpError(optionsRes) };
  // SAFETY: the registration-options endpoint returns SimpleWebAuthn's creation options contract.
  const optionsJSON = (await optionsRes.json()) as PublicKeyCredentialCreationOptionsJSON;

  let attestation;
  try {
    attestation = await startRegistration({ optionsJSON });
  } catch {
    return { ok: false, error: "passkey_cancelled" };
  }

  const verifyRes = await apiFetch("/auth/passkey/register/verify", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ response: attestation, label }),
  });
  if (!verifyRes.ok) return { ok: false, error: await parseHttpError(verifyRes) };
  return { ok: true, value: undefined };
}

// Authentication ceremony: fetch request options, prompt the authenticator, then
// verify. A thrown ceremony means the user dismissed the prompt. The caller owns
// what a returned session does next, so both clients share this much.
export async function passkeyLogin(email: string): Promise<Result<SessionEnvelope>> {
  const optionsRes = await apiFetch("/auth/passkey/login/options", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email }),
  });
  if (!optionsRes.ok) return { ok: false, error: await parseHttpError(optionsRes) };
  // SAFETY: the login-options endpoint returns SimpleWebAuthn's request options contract.
  const optionsJSON = (await optionsRes.json()) as PublicKeyCredentialRequestOptionsJSON;

  let assertion;
  try {
    assertion = await startAuthentication({ optionsJSON });
  } catch {
    return { ok: false, error: "passkey_cancelled" };
  }

  const verifyRes = await apiFetch("/auth/passkey/login/verify", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ response: assertion }),
  });
  if (!verifyRes.ok) return { ok: false, error: await parseHttpError(verifyRes) };
  const session = decode(SessionEnvelope, await verifyRes.json());
  return session ? { ok: true, value: session } : { ok: false, error: "verification_failed" };
}

// Whether this device/browser can plausibly use passkeys. Cheap gate for the UI.
export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}
