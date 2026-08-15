import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { Schema } from "effect";

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === "object" && value !== null;
const hasString = <K extends PropertyKey>(
  value: Record<PropertyKey, unknown>,
  key: K,
): value is Record<PropertyKey, unknown> & Record<K, string> => typeof value[key] === "string";

type CredentialEnvelope = {
  id: string;
  rawId: string;
  type: "public-key";
  clientExtensionResults: Record<PropertyKey, unknown>;
  response: Record<PropertyKey, unknown> & { clientDataJSON: string };
};

const hasCredentialEnvelope = (value: unknown): value is CredentialEnvelope =>
  isRecord(value) &&
  hasString(value, "id") &&
  hasString(value, "rawId") &&
  "type" in value &&
  value.type === "public-key" &&
  "clientExtensionResults" in value &&
  isRecord(value.clientExtensionResults) &&
  "response" in value &&
  isRecord(value.response) &&
  hasString(value.response, "clientDataJSON");

export const RegistrationResponse = Schema.declare<RegistrationResponseJSON>(
  (value): value is RegistrationResponseJSON =>
    hasCredentialEnvelope(value) && hasString(value.response, "attestationObject"),
);

export const AuthenticationResponse = Schema.declare<AuthenticationResponseJSON>(
  (value): value is AuthenticationResponseJSON =>
    hasCredentialEnvelope(value) &&
    hasString(value.response, "authenticatorData") &&
    hasString(value.response, "signature"),
);
