import type { AuthenticatorTransportFuture, WebAuthnCredential } from "@simplewebauthn/server";
import * as Encoding from "effect/Encoding";
import * as Result from "effect/Result";

export const RP_NAME = "Bookclub";

// WebAuthn binds credentials to a Relying Party ID (a registrable domain) and
// validates the ceremony against the calling origin. Both are derived from the
// request URL so the same worker serves localhost dev, the custom domain, and
// the workers.dev fallback — each an independent passkey scope.
export interface RpConfig {
  rpID: string;
  origin: string;
}

export function rpConfig(request: Request): RpConfig {
  const url = new URL(request.url);
  return { rpID: url.hostname, origin: url.origin };
}

// Stored form of a credential: DO state is JSON, so the public key bytes are
// held as base64url and rehydrated into the Uint8Array the SDK expects.
export interface StoredCredential {
  id: string;
  publicKey: string;
  counter: number;
  transports?: AuthenticatorTransportFuture[];
  label: string;
  createdAt: string;
}

export function toStoredCredential(
  credential: WebAuthnCredential,
  label: string,
): StoredCredential {
  return {
    id: credential.id,
    publicKey: Encoding.encodeBase64Url(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports,
    label,
    createdAt: new Date().toISOString(),
  };
}

export function toWebAuthnCredential(stored: StoredCredential): WebAuthnCredential {
  return {
    id: stored.id,
    publicKey: Uint8Array.from(Result.getOrThrow(Encoding.decodeBase64Url(stored.publicKey))),
    counter: stored.counter,
    transports: stored.transports,
  };
}
