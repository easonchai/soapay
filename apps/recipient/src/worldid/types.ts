/**
 * World ID seam (docs/mvp-spec.md §2.1, §5, docs/worldid.md). World ID is used at ONE trust moment:
 * account recovery (key rotation). At onboarding the user MAY link World ID (`mode="create-session"`,
 * a historical name); a later rotation proves it's the same human (`mode="rotate"`). Both are one-time
 * Proof of Human requests on the `soapay-recovery` action; the API links the proof's nullifier and
 * accepts a rotation only with the same nullifier (D-58).
 *
 * The props mirror `@soapay/worldid-react`'s `<HumanCheck>`; see ./index.ts for which implementation
 * is used (the real one, or the mock in VITE_MOCK_API mode).
 */
import { worldIdNullifierOf } from "@soapay/sdk";

export { rotationSignal, sessionSignal } from "@soapay/sdk";

export type HumanCheckMode = "create-session" | "rotate";

/**
 * The IDKit result (a v4 one-time Proof of Human proof). Opaque to the app: it is forwarded UNCHANGED to
 * the API (`worldIdSession` on POST /names, `worldIdResult` on /session and /rotation), which verifies it.
 */
export type HumanCheckResult = Record<string, unknown>;

export type HumanCheckProps = {
  mode: HumanCheckMode;
  /** Soapay API base URL: the component fetches a fresh RP context from `/worldid/rp-context`. */
  apiUrl: string;
  /** @deprecated Ignored since D-58: the API matches the nullifier, the client needs nothing saved. */
  sessionId?: string;
  /** `sessionSignal(label, registrant)` or `rotationSignal(label, newMeta, deadline)` from the SDK. */
  signal: string;
  onResult: (r: HumanCheckResult) => void | Promise<void>;
  onCancel?: () => void;
  onError?: (e: Error & { code?: string }) => void;
};

/**
 * The World ID link to keep in the vault: the proof's nullifier (0x hex, 32 bytes), or undefined when
 * the result carries none. It only records that recovery is set up; the API keeps its own copy.
 */
export function worldIdLinkOf(r: HumanCheckResult | undefined): string | undefined {
  const n = worldIdNullifierOf(r);
  return n === undefined ? undefined : `0x${n.toString(16).padStart(64, "0")}`;
}
