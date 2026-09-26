/**
 * World ID seam (docs/mvp-spec.md §2.1, §5, docs/worldid.md). World ID is used at ONE trust moment:
 * self-service key rotation. At onboarding the user MAY create a Proof of Human session
 * (`mode="create-session"`); a later rotation proves that same session (`mode="rotate"`).
 *
 * The props mirror `@soapay/worldid-react`'s `<HumanCheck>`; see ./index.ts for which implementation
 * is used (the real one, or the mock in VITE_MOCK_API mode).
 */
export { rotationSignal, sessionSignal } from "@soapay/sdk";

export type HumanCheckMode = "create-session" | "rotate";

/**
 * The IDKit session result (`IDKitResultSession`). Opaque to the app: it is forwarded UNCHANGED to the
 * API (`worldIdSession` on POST /names, `worldIdResult` on /session and /rotation), which verifies it.
 */
export type HumanCheckResult = { session_id?: string } & Record<string, unknown>;

export type HumanCheckProps = {
  mode: HumanCheckMode;
  /** Soapay API base URL: the component fetches a fresh RP context from `/worldid/rp-context`. */
  apiUrl: string;
  /** The `session_<hex>` saved at enrollment; required for `mode="rotate"`. */
  sessionId?: string;
  /** `sessionSignal(label, registrant)` or `rotationSignal(label, newMeta, deadline)` from the SDK. */
  signal: string;
  onResult: (r: HumanCheckResult) => void | Promise<void>;
  onCancel?: () => void;
  onError?: (e: Error & { code?: string }) => void;
};

/** The session id to keep in the vault (needed to rotate later). */
export function sessionIdOf(r: HumanCheckResult | undefined): string | undefined {
  const id = r?.session_id;
  return typeof id === "string" && /^session_[0-9a-fA-F]+$/.test(id) ? id : undefined;
}
