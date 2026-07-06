import { base64urlEncode } from "../../../src/shared/base64url.ts";

// A software WebAuthn authenticator: it plays the exact role a browser +
// platform authenticator play during a passkey ceremony, so the e2e suite can
// drive passkeys through the product's real HTTP surface with no browser. It
// mirrors what Chrome's virtual authenticator emits — an ES256 (P-256) key, a
// "none"-attestation registration, and DER-encoded assertion signatures — which
// the server verifies with @simplewebauthn exactly as it would a real device.
//
// This is deliberately NOT importing any server internals: it only produces the
// wire-format JSON the client would POST, and holds its own key material.

// --- Minimal CBOR encoder (only the shapes an attestation object needs) ---

function head(major: number, value: number): Uint8Array<ArrayBuffer> {
  const m = major << 5;
  if (value < 24) return Uint8Array.of(m | value);
  if (value < 0x100) return Uint8Array.of(m | 24, value);
  if (value < 0x10000) return Uint8Array.of(m | 25, value >> 8, value & 0xff);
  return Uint8Array.of(
    m | 26,
    (value >>> 24) & 0xff,
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  );
}

function concat(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

const cborUint = (n: number): Uint8Array => head(0, n);
const cborNegInt = (n: number): Uint8Array => head(1, -1 - n); // n is negative
const cborBytes = (b: Uint8Array): Uint8Array => concat([head(2, b.length), b]);
const cborText = (s: string): Uint8Array =>
  concat([head(3, s.length), new TextEncoder().encode(s)]);

// A CBOR map from pre-encoded key/value byte pairs, in the given order.
const cborMap = (pairs: [Uint8Array, Uint8Array][]): Uint8Array =>
  concat([head(5, pairs.length), ...pairs.flat()]);

// --- ECDSA raw (r‖s) → ASN.1 DER, which WebAuthn requires for ES256 ---

function derInteger(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  let trimmed: Uint8Array<ArrayBuffer> = bytes.slice(start);
  if (trimmed[0]! & 0x80) trimmed = concat([Uint8Array.of(0), trimmed]);
  return concat([Uint8Array.of(0x02, trimmed.length), trimmed]);
}

function rawSignatureToDer(raw: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const r = derInteger(raw.slice(0, 32));
  const s = derInteger(raw.slice(32, 64));
  const body = concat([r, s]);
  return concat([Uint8Array.of(0x30, body.length), body]);
}

// --- helpers ---

async function sha256(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

function b64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replaceAll("-", "+").replaceAll("_", "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.codePointAt(i)!;
  return out;
}

interface RegistrationOptions {
  challenge: string;
  rp: { id: string };
}

interface AuthenticationOptions {
  challenge: string;
  rpId: string;
}

export interface AttestationResponseJSON {
  id: string;
  rawId: string;
  type: "public-key";
  response: { clientDataJSON: string; attestationObject: string; transports: string[] };
  clientExtensionResults: Record<string, unknown>;
}

export interface AssertionResponseJSON {
  id: string;
  rawId: string;
  type: "public-key";
  response: { clientDataJSON: string; authenticatorData: string; signature: string };
  clientExtensionResults: Record<string, unknown>;
}

export class SoftwareAuthenticator {
  private signCount = 0;

  private constructor(
    private readonly keyPair: CryptoKeyPair,
    private readonly credentialId: Uint8Array,
    private readonly coseKey: Uint8Array,
  ) {}

  static async create(): Promise<SoftwareAuthenticator> {
    const keyPair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
    ])) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const x = b64urlToBytes(jwk.x!);
    const y = b64urlToBytes(jwk.y!);
    // COSE_Key for an EC2 P-256 ES256 public key.
    const cose = cborMap([
      [cborUint(1), cborUint(2)], // kty: EC2
      [cborUint(3), cborNegInt(-7)], // alg: ES256
      [cborNegInt(-1), cborUint(1)], // crv: P-256
      [cborNegInt(-2), cborBytes(x)], // x
      [cborNegInt(-3), cborBytes(y)], // y
    ]);
    return new SoftwareAuthenticator(keyPair, crypto.getRandomValues(new Uint8Array(32)), cose);
  }

  get id(): string {
    return base64urlEncode(this.credentialId);
  }

  private clientDataJSON(
    type: "webauthn.create" | "webauthn.get",
    challenge: string,
    origin: string,
  ): Uint8Array {
    return new TextEncoder().encode(
      JSON.stringify({ type, challenge, origin, crossOrigin: false }),
    );
  }

  private counterBytes(): Uint8Array {
    const n = ++this.signCount;
    return Uint8Array.of((n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
  }

  async attest(options: RegistrationOptions, origin: string): Promise<AttestationResponseJSON> {
    const rpIdHash = await sha256(new TextEncoder().encode(options.rp.id));
    const flags = Uint8Array.of(0x45); // UP | UV | AT
    const aaguid = new Uint8Array(16);
    const credIdLen = Uint8Array.of(
      (this.credentialId.length >> 8) & 0xff,
      this.credentialId.length & 0xff,
    );
    const authData = concat([
      rpIdHash,
      flags,
      this.counterBytes(),
      aaguid,
      credIdLen,
      this.credentialId,
      this.coseKey,
    ]);
    const attestationObject = cborMap([
      [cborText("fmt"), cborText("none")],
      [cborText("attStmt"), cborMap([])],
      [cborText("authData"), cborBytes(authData)],
    ]);
    const clientDataJSON = this.clientDataJSON("webauthn.create", options.challenge, origin);
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: base64urlEncode(clientDataJSON),
        attestationObject: base64urlEncode(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
    };
  }

  async assert(options: AuthenticationOptions, origin: string): Promise<AssertionResponseJSON> {
    const rpIdHash = await sha256(new TextEncoder().encode(options.rpId));
    const flags = Uint8Array.of(0x05); // UP | UV
    const authData = concat([rpIdHash, flags, this.counterBytes()]);
    const clientDataJSON = this.clientDataJSON("webauthn.get", options.challenge, origin);
    const clientDataHash = await sha256(clientDataJSON);
    const signed = concat([authData, clientDataHash]);
    const rawSig = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        this.keyPair.privateKey,
        signed as BufferSource,
      ),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: base64urlEncode(clientDataJSON),
        authenticatorData: base64urlEncode(authData),
        signature: base64urlEncode(rawSignatureToDer(rawSig)),
      },
      clientExtensionResults: {},
    };
  }
}
