/**
 * World ID seam (docs/mvp-spec.md §2.1, §5). World ID is used at ONE trust moment: self-service key
 * rotation. At onboarding the user MAY create a Selfie Check session (`mode="create-session"`); a later
 * rotation proves that same session (`mode="rotate"`, `proveSession`). Onboarding never requires it.
 *
 * These types mirror the `<HumanCheck>` component that `@soapay/worldid-react` exports, so the
 * placeholder in ./HumanCheckPlaceholder.tsx and the real component are interchangeable (see ./index.ts).
 */

export type HumanCheckMode = "create-session" | "rotate";

export type HumanCheckResult = {
  /**
   * The IDKit session result. `create-session`: posted as `session` with POST /names (or
   * POST /names/:label/session). `rotate`: posted as `worldIdResult` with POST /names/:label/rotation.
   */
  session?: unknown;
  /** Set only by the placeholder: nothing was verified (testnet). The API never attests it. */
  placeholder?: true;
};

export type HumanCheckProps = {
  mode: HumanCheckMode;
  /** Soapay API base URL: the component fetches its RP context from `/worldid/*`. */
  apiUrl: string;
  /** The session saved at onboarding; required for `mode="rotate"` (the same person). */
  sessionId?: string;
  /** Text signal binding the proof (0x-hex signals are hashed as bytes, so ours use a `soapay:` prefix). */
  signal: string;
  onResult: (r: HumanCheckResult) => void;
  onCancel?: () => void;
  onError?: (e: unknown) => void;
};

/** The session id to keep in the vault (needed to rotate later). */
export function sessionIdOf(r: HumanCheckResult): string | undefined {
  const s = r.session as { session_id?: unknown; sessionId?: unknown } | undefined | null;
  const id = s?.session_id ?? s?.sessionId;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

/** Must equal the SDK/API `enrollSignal(registrant)`: the session is bound to this registrant. */
export const sessionSignal = (registrant: string) => `soapay:enroll:${registrant.toLowerCase()}`;

/** Must equal the SDK/API `rotationSignal(label, newMeta, deadline)`: the proof is bound to this exact rotation. */
export const rotateSignal = (label: string, newMeta: string, deadline: bigint) =>
  `soapay:rotate:${label}:${newMeta.trim().toLowerCase()}:${deadline}`;
