/**
 * WebAuthn behind an injectable interface (D-35), so the vault and the onboarding flow can be tested in jsdom
 * and mock mode can click through without a real authenticator.
 *
 * The browser implementation creates a platform passkey (rp id = current hostname, user verification
 * required) with the PRF extension, and evaluates PRF over the app salt on every unlock. When the browser
 * or authenticator has no PRF support it throws `PasskeyUnsupportedError`, and the caller falls back to the
 * passphrase lock.
 */
import { toBase64 } from "./crypto.js";

export class PasskeyUnsupportedError extends Error {
  override name = "PasskeyUnsupportedError";
  constructor(message = "This browser or device can't use a passkey to encrypt your keys.") {
    super(message);
  }
}

export interface PasskeyAuthenticator {
  /** True for the mock implementation (mock mode). */
  readonly mock: boolean;
  /** Cheap check, no prompt. `false` means skip straight to the passphrase lock. */
  available(): Promise<boolean>;
  /**
   * Creates a passkey and returns its raw id and the PRF output over `prfSalt`. May prompt twice.
   * `account` names it in the user's password manager (e.g. "alice.soapay.eth"); defaults to "Soapay account".
   */
  register(prfSalt: Uint8Array<ArrayBuffer>, account?: string): Promise<{ credentialId: Uint8Array<ArrayBuffer>; prf: Uint8Array<ArrayBuffer> }>;
  /** Evaluates PRF over `prfSalt` with an existing passkey (one prompt). */
  evaluate(credentialId: Uint8Array<ArrayBuffer>, prfSalt: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>;
}

type PrfOutputs = { enabled?: boolean; results?: { first?: BufferSource } };

const random = (n: number): Uint8Array<ArrayBuffer> => globalThis.crypto.getRandomValues(new Uint8Array(n));

function toBytes(b: BufferSource): Uint8Array<ArrayBuffer> {
  return b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

function prfOf(cred: PublicKeyCredential): PrfOutputs | undefined {
  return (cred.getClientExtensionResults() as { prf?: PrfOutputs }).prf;
}

/** Maps the WebAuthn DOMExceptions users actually hit to plain words. */
function friendly(e: unknown): Error {
  const name = (e as { name?: string } | null)?.name;
  if (name === "NotAllowedError") return new Error("The passkey prompt was cancelled or timed out. Try again.");
  if (name === "InvalidStateError") return new Error("This device already has a Soapay passkey. Try again, or use a passphrase.");
  if (name === "SecurityError") return new Error("Passkeys need HTTPS (or localhost) on this site's own domain.");
  if (name === "NotSupportedError") return new PasskeyUnsupportedError();
  return e instanceof Error ? e : new Error(String(e));
}

export function browserPasskey(): PasskeyAuthenticator {
  const rpId = () => globalThis.location.hostname;
  const evaluate = async (credentialId: Uint8Array<ArrayBuffer>, prfSalt: Uint8Array<ArrayBuffer>) => {
    let cred: PublicKeyCredential | null;
    try {
      cred = (await navigator.credentials.get({
        publicKey: {
          challenge: random(32),
          rpId: rpId(),
          allowCredentials: [{ type: "public-key", id: credentialId }],
          userVerification: "required",
          timeout: 120_000,
          extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
        },
      })) as PublicKeyCredential | null;
    } catch (e) {
      throw friendly(e);
    }
    if (!cred) throw new Error("No passkey was used.");
    const first = prfOf(cred)?.results?.first;
    if (!first) throw new PasskeyUnsupportedError("This passkey didn't return its encryption secret (no PRF support).");
    return toBytes(first);
  };
  return {
    mock: false,
    async available() {
      if (typeof globalThis.PublicKeyCredential === "undefined" || !navigator.credentials?.create) return false;
      try {
        // Chrome/Safari report PRF support up front; elsewhere we find out after creating the passkey.
        const caps = await (PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean | undefined>> })
          .getClientCapabilities?.();
        if (caps && caps["extension:prf"] === false) return false;
        return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      } catch {
        return false;
      }
    },
    async register(prfSalt, account) {
      const name = account?.trim() || "Soapay account";
      let cred: PublicKeyCredential | null;
      try {
        cred = (await navigator.credentials.create({
          publicKey: {
            rp: { name: "Soapay", id: rpId() },
            user: { id: random(16), name, displayName: `Soapay · ${name}` },
            challenge: random(32),
            pubKeyCredParams: [
              { type: "public-key", alg: -7 },
              { type: "public-key", alg: -257 },
            ],
            authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
            attestation: "none",
            timeout: 120_000,
            extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
          },
        })) as PublicKeyCredential | null;
      } catch (e) {
        throw friendly(e);
      }
      if (!cred) throw new Error("No passkey was created.");
      const credentialId = new Uint8Array(cred.rawId);
      const prf = prfOf(cred);
      // Some authenticators return the PRF result at creation; most only say it's enabled.
      if (prf?.results?.first) return { credentialId, prf: toBytes(prf.results.first) };
      if (prf?.enabled !== true) throw new PasskeyUnsupportedError();
      return { credentialId, prf: await evaluate(credentialId, prfSalt) };
    },
    evaluate,
  };
}

/**
 * Mock mode (VITE_MOCK_API): no authenticator. The "PRF" is SHA-256 over a fixed label, the credential id
 * and the salt, so anyone with the browser profile can unlock. For demos only, like the rest of mock mode.
 */
export function mockPasskey(): PasskeyAuthenticator {
  const prf = async (id: Uint8Array, salt: Uint8Array) => {
    const label = new TextEncoder().encode(`soapay-mock-passkey:${toBase64(id)}:`);
    const buf = new Uint8Array(label.length + salt.length);
    buf.set(label);
    buf.set(salt, label.length);
    return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", buf));
  };
  return {
    mock: true,
    available: async () => true,
    async register(prfSalt) {
      const credentialId = random(16);
      return { credentialId, prf: await prf(credentialId, prfSalt) };
    },
    evaluate: (credentialId, prfSalt) => prf(credentialId, prfSalt),
  };
}
