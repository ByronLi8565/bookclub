import * as Encoding from "effect/Encoding";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { constantTimeEqualBytes } from "../../shared/crypto.ts";

const encoder = new TextEncoder();

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signToken<A extends { exp: number }>(
  claims: A,
  secret: string,
): Promise<string> {
  const payload = Encoding.encodeBase64Url(encoder.encode(JSON.stringify(claims)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${Encoding.encodeBase64Url(new Uint8Array(sig))}`;
}

export async function verifyToken<A extends { exp: number }>(
  schema: Schema.Decoder<A>,
  token: string,
  secret: string,
): Promise<A | null> {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const key = await hmacKey(secret);
  try {
    const expected = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    const provided = Result.getOrThrow(Encoding.decodeBase64Url(signature));
    if (!constantTimeEqualBytes(new Uint8Array(expected), provided)) return null;
    const claims = Option.getOrNull(
      Schema.decodeUnknownOption(schema)(
        JSON.parse(new TextDecoder().decode(Result.getOrThrow(Encoding.decodeBase64Url(payload)))),
      ),
    );
    return claims === null || claims.exp < Date.now() ? null : claims;
  } catch {
    return null;
  }
}
