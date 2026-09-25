/**
 * World ID seam (docs/mvp-spec.md §2.1, §5). These types mirror the `<HumanCheck>` component that
 * `@soapay/worldid-react` exports, so the placeholder in ./HumanCheckPlaceholder.tsx and the real
 * component are interchangeable (see ./index.ts).
 */

export type HumanCheckMode = "enroll" | "rotate";

export type HumanCheckResult = {
  /** Uniqueness proof (action `soapay-enroll`). Enrollment only; posted as `proof` to /register and /names. */
  proof?: unknown;
  /** Session result (enrollment session, or `proveSession` on rotation). Posted as `session` on
   *  enrollment and as `worldIdResult` on POST /names/:label/rotation. */
  session?: unknown;
  /** Set only by the placeholder: nothing was verified (testnet). */
  placeholder?: true;
};

export type HumanCheckProps = {
  mode: HumanCheckMode;
  /** Soapay API base URL: the component fetches its RP context from `/worldid/*`. */
  apiUrl: string;
  /** The session saved at enrollment; required for `mode="rotate"` (the same human). */
  sessionId?: string;
  /** Text signal binding the proof, e.g. `soapay:enroll:0x…` (0x-hex signals are hashed as bytes). */
  signal: string;
  onResult: (r: HumanCheckResult) => void;
  onCancel?: () => void;
  onError?: (e: unknown) => void;
};

/** The session id to keep in the vault after enrollment (needed to rotate later). */
export function sessionIdOf(r: HumanCheckResult): string | undefined {
  const s = r.session as { session_id?: unknown; sessionId?: unknown } | undefined | null;
  const id = s?.session_id ?? s?.sessionId;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

export const enrollSignal = (registrant: string) => `soapay:enroll:${registrant.toLowerCase()}`;
export const rotateSignal = (label: string, newMeta: string) => `soapay:rotate:${label}:${newMeta.toLowerCase()}`;
