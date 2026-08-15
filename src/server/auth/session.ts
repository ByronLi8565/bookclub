import * as Encoding from "effect/Encoding";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { constantTimeEqualBytes } from "../../shared/crypto.ts";
import { hmacKey } from "./hmac.ts";

export interface SessionClaims {
  userId: string;
  email: string;
  name: string;
  exp: number;
}

const SessionClaimsSchema = Schema.Struct({
  userId: Schema.String,
  email: Schema.String,
  name: Schema.String,
  exp: Schema.Number,
});

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();

export async function signSession(claims: SessionClaims, secret: string): Promise<string> {
  const payload = Encoding.encodeBase64Url(encoder.encode(JSON.stringify(claims)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${Encoding.encodeBase64Url(new Uint8Array(sig))}`;
}

export async function verifySession(token: string, secret: string): Promise<SessionClaims | null> {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const key = await hmacKey(secret);
  let expected: ArrayBuffer;
  try {
    expected = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  } catch {
    return null;
  }
  let provided: Uint8Array;
  try {
    provided = Result.getOrThrow(Encoding.decodeBase64Url(signature));
  } catch {
    return null;
  }
  if (!constantTimeEqualBytes(new Uint8Array(expected), provided)) return null;

  let claims: SessionClaims | null;
  try {
    claims = Option.getOrNull(
      Schema.decodeUnknownOption(SessionClaimsSchema)(
        JSON.parse(new TextDecoder().decode(Result.getOrThrow(Encoding.decodeBase64Url(payload)))),
      ),
    );
  } catch {
    return null;
  }
  if (claims === null || claims.exp < Date.now()) return null;
  return claims;
}
