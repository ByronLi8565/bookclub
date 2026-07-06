import {
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
} from "@simplewebauthn/browser";
import { parseHttpError } from "../../http.ts";
import type { PasskeyInfo } from "../../../shared/types/passkeys.ts";

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };

const json = { "Content-Type": "application/json" };

export async function listPasskeys(): Promise<Result<PasskeyInfo[]>> {
  const r = await fetch("/me/passkeys");
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  const body = (await r.json()) as { passkeys: PasskeyInfo[] };
  return { ok: true, value: body.passkeys };
}

// Registration ceremony: fetch creation options, prompt the authenticator, then
// verify. A thrown ceremony means the user dismissed the prompt.
export async function registerPasskey(label: string): Promise<Result> {
  const optionsRes = await fetch("/auth/passkey/register/options", { method: "POST" });
  if (!optionsRes.ok) return { ok: false, error: await parseHttpError(optionsRes) };
  const optionsJSON = (await optionsRes.json()) as PublicKeyCredentialCreationOptionsJSON;

  let attestation;
  try {
    attestation = await startRegistration({ optionsJSON });
  } catch {
    return { ok: false, error: "passkey_cancelled" };
  }

  const verifyRes = await fetch("/auth/passkey/register/verify", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ response: attestation, label }),
  });
  if (!verifyRes.ok) return { ok: false, error: await parseHttpError(verifyRes) };
  return { ok: true, value: undefined };
}

export async function removePasskey(id: string): Promise<Result> {
  const r = await fetch(`/me/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  return { ok: true, value: undefined };
}

export async function setPassword(password: string, currentPassword?: string): Promise<Result> {
  const r = await fetch("/me/password", {
    method: "PUT",
    headers: json,
    body: JSON.stringify({ password, currentPassword }),
  });
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  return { ok: true, value: undefined };
}

export async function removePassword(currentPassword: string): Promise<Result> {
  const r = await fetch("/me/password", {
    method: "DELETE",
    headers: json,
    body: JSON.stringify({ currentPassword }),
  });
  if (!r.ok) return { ok: false, error: await parseHttpError(r) };
  return { ok: true, value: undefined };
}

// Whether this device/browser can plausibly use passkeys. Cheap gate for the UI.
export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}
