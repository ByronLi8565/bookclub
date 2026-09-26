import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { Data, Effect } from "effect";
import { bookclubClient } from "../net/bookclubClient.ts";

/** The part of a ceremony the API contract cannot type: options it could not
 *  have produced, or a browser prompt that threw, which is how a dismissed one
 *  arrives. It carries the same `error` code field the API's own errors do, so
 *  one mapping turns either into a sentence. */
export class PasskeyCeremonyFailed extends Data.TaggedError("PasskeyCeremonyFailed")<{
  readonly error: "passkey_cancelled" | "verification_failed";
}> {}

type JsonObject = { readonly [key: string]: unknown };

const isCreationOptions = (
  options: JsonObject,
): options is JsonObject & PublicKeyCredentialCreationOptionsJSON =>
  typeof options.challenge === "string" &&
  typeof options.rp === "object" &&
  typeof options.user === "object" &&
  Array.isArray(options.pubKeyCredParams);

const isRequestOptions = (
  options: JsonObject,
): options is JsonObject & PublicKeyCredentialRequestOptionsJSON =>
  typeof options.challenge === "string";

/** The options endpoints answer with SimpleWebAuthn's JSON, which the contract
 *  carries as an open object; it is checked here, where it is used. */
const prompt = <Options, Response>(
  options: JsonObject,
  isOptions: (options: JsonObject) => options is JsonObject & Options,
  ask: (optionsJSON: Options) => Promise<Response>,
) =>
  isOptions(options)
    ? Effect.tryPromise({
        try: () => ask(options),
        catch: () => new PasskeyCeremonyFailed({ error: "passkey_cancelled" }),
      })
    : Effect.fail(new PasskeyCeremonyFailed({ error: "verification_failed" }));

// Registration ceremony: fetch creation options, prompt the authenticator, then
// verify.
export const registerPasskey = (label: string) =>
  bookclubClient.pipe(
    Effect.flatMap((client) =>
      client.auth.passkeyRegistrationOptions({}).pipe(
        Effect.flatMap((options) =>
          prompt(options, isCreationOptions, (optionsJSON) => startRegistration({ optionsJSON })),
        ),
        Effect.flatMap((response) =>
          client.auth.verifyPasskeyRegistration({ payload: { response, label } }),
        ),
      ),
    ),
    Effect.asVoid,
  );

// Authentication ceremony: fetch request options, prompt the authenticator, then
// verify. The caller owns what the returned session does next.
export const passkeyLogin = (email: string) =>
  bookclubClient.pipe(
    Effect.flatMap((client) =>
      client.auth.passkeyLoginOptions({ payload: { email } }).pipe(
        Effect.flatMap((options) =>
          prompt(options, isRequestOptions, (optionsJSON) => startAuthentication({ optionsJSON })),
        ),
        Effect.flatMap((response) => client.auth.verifyPasskeyLogin({ payload: { response } })),
      ),
    ),
  );

// Whether this device/browser can plausibly use passkeys. Cheap gate for the UI.
export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}
