import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CredentialRequest, IDKitErrorCodes, type ConstraintNode, type IDKitResultSession, type RpContext } from "@worldcoin/idkit";
import { IDKit, selfieCheck, type IDKitRequest } from "@worldcoin/idkit-core";
import QRCode from "qrcode";

export type { IDKitResultSession } from "@worldcoin/idkit";

/**
 * - `create-session`: create a new World ID session (at enrollment, or to attach one later).
 * - `rotate`: prove the session saved for this name (`sessionId` is required).
 */
export type HumanCheckMode = "create-session" | "rotate";

export type HumanCheckProps = {
  mode: HumanCheckMode;
  /** Soapay API base URL, e.g. `https://api.soapay.xyz`. The RP context is signed there. */
  apiUrl: string;
  /** The saved `session_<hex>` id. Required for `rotate`, ignored for `create-session`. */
  sessionId?: `session_${string}` | undefined;
  /**
   * The signal the API expects: `sessionSignal(label, registrant)` to create a session,
   * `rotationSignal(label, newMeta, deadline)` to rotate (both from `@soapay/sdk`).
   */
  signal: string;
  /** The IDKit session result. Send it to the API unchanged (`worldIdSession` / `worldIdResult`). */
  onResult: (result: IDKitResultSession) => void | Promise<void>;
  /** The user closed the widget or declined in World App. */
  onCancel?: () => void;
  /** Anything else: the API couldn't sign an RP context, or World App returned an error. */
  onError?: (error: HumanCheckError) => void;
  /** Controlled open state. Omit it to render a button that opens the widget. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Button label (uncontrolled mode). */
  children?: ReactNode;
  /** Shown in World App. */
  actionDescription?: string;
  fetch?: typeof fetch;
};

export class HumanCheckError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HumanCheckError";
  }
}

export type RpContextResponse = {
  rp_context: RpContext;
  app_id: `app_${string}`;
  environment: "production" | "staging" | "sandbox";
};

/**
 * The Selfie Check credential as a session constraint. IDKit 4.3's `IDKitSessionWidget`
 * takes `constraints` (not `preset={selfieCheck()}` as the session-proof docs show).
 */
export function selfieCheckConstraint(signal: string): ConstraintNode {
  return CredentialRequest("selfie", { signal });
}

/** POST {apiUrl}/worldid/rp-context: a fresh, single-use RP signature for one session request. */
export async function fetchRpContext(apiUrl: string, f: typeof fetch = fetch): Promise<RpContextResponse> {
  let res: Response;
  try {
    res = await f(`${apiUrl.replace(/\/+$/, "")}/worldid/rp-context`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "session" }),
    });
  } catch {
    throw new HumanCheckError("api_unreachable", "Soapay API is unreachable");
  }
  const body = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    throw new HumanCheckError(body?.error?.code ?? `http_${res.status}`, body?.error?.message ?? "could not start World ID");
  }
  return body as RpContextResponse;
}

const CANCEL_CODES = new Set<string>([IDKitErrorCodes.UserRejected, IDKitErrorCodes.Cancelled]);

/**
 * World ID check for Soapay's single trust moment: key rotation (docs/worldid.md).
 *
 * Builds the session request with IDKit core's `createSession` / `proveSession(...).preset(selfieCheck())`,
 * exactly as World's session-proof docs show. IDKit 4.3's `IDKitSessionWidget` only takes hand-built
 * `constraints`, and a `CredentialRequest("selfie")` constraint made the production World App answer
 * `generic_error` (2026-09-26), so we render the QR code and poll ourselves.
 */
export function HumanCheck(props: HumanCheckProps) {
  const { mode, apiUrl, sessionId, signal, onResult, actionDescription } = props;
  const controlled = props.open !== undefined;
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlled ? !!props.open : innerOpen;
  const [uri, setUri] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState<"starting" | "waiting" | "confirming">("starting");
  const cbs = useRef({ onCancel: props.onCancel, onError: props.onError, onOpenChange: props.onOpenChange, onResult });
  cbs.current = { onCancel: props.onCancel, onError: props.onError, onOpenChange: props.onOpenChange, onResult };
  const abort = useRef<AbortController | null>(null);

  const setOpen = useCallback(
    (v: boolean) => {
      if (!controlled) setInnerOpen(v);
      cbs.current.onOpenChange?.(v);
    },
    [controlled],
  );

  useEffect(() => {
    if (!open) return;
    if (mode === "rotate" && !sessionId) {
      cbs.current.onError?.(new HumanCheckError("no_session", "this name has no World ID session to prove"));
      setOpen(false);
      return;
    }
    const ac = new AbortController();
    abort.current = ac;
    setUri(null);
    setQr(null);
    setStatus("starting");
    void (async () => {
      let request: IDKitRequest;
      try {
        const ctx = await fetchRpContext(apiUrl, props.fetch); // a fresh RP context per request
        const config = {
          app_id: ctx.app_id,
          rp_context: ctx.rp_context,
          environment: ctx.environment,
          ...(actionDescription ? { action_description: actionDescription } : {}),
        };
        const builder = mode === "rotate" && sessionId ? IDKit.proveSession(sessionId, config) : IDKit.createSession(config);
        request = await builder.preset(selfieCheck({ signal }));
      } catch (e) {
        if (ac.signal.aborted) return;
        cbs.current.onError?.(e instanceof HumanCheckError ? e : new HumanCheckError("start_failed", `World ID failed to start: ${String(e)}`));
        setOpen(false);
        return;
      }
      if (ac.signal.aborted) return;
      setUri(request.connectorURI);
      setStatus("waiting");
      QRCode.toDataURL(request.connectorURI, { width: 220, margin: 1, errorCorrectionLevel: "M" })
        .then((u) => !ac.signal.aborted && setQr(u))
        .catch(() => undefined);
      const done = await request.pollUntilCompletion({ signal: ac.signal, timeout: 300_000 }).catch((e: unknown) => ({
        success: false as const,
        error: (ac.signal.aborted ? IDKitErrorCodes.Cancelled : String(e)) as IDKitErrorCodes,
      }));
      if (ac.signal.aborted) return;
      if (done.success) {
        setStatus("confirming");
        try {
          await cbs.current.onResult(done.result as IDKitResultSession);
        } finally {
          setOpen(false);
        }
        return;
      }
      if (CANCEL_CODES.has(done.error)) cbs.current.onCancel?.();
      else cbs.current.onError?.(new HumanCheckError(done.error, `World ID failed: ${done.error}`));
      setOpen(false);
    })();
    return () => ac.abort();
  }, [open, mode, sessionId, apiUrl, signal, actionDescription, props.fetch, setOpen]);

  const cancel = () => {
    abort.current?.abort();
    cbs.current.onCancel?.();
    setOpen(false);
  };

  return (
    <>
      {!controlled && (
        <button type="button" onClick={() => setOpen(true)} disabled={open}>
          {props.children ?? (mode === "rotate" ? "Confirm it's you with World ID" : "Protect with World ID")}
        </button>
      )}
      {open && (
        <div role="dialog" aria-label="Verify with World ID" data-testid="worldid-panel" style={panel}>
          <strong>{mode === "rotate" ? "Confirm it's you with World ID" : "Link World ID (Selfie Check)"}</strong>
          {status === "starting" && <span>Preparing the request…</span>}
          {status !== "starting" && uri && (
            <>
              <span>Scan with World App, or open it on this phone.</span>
              {qr ? <img src={qr} width={220} height={220} alt="World ID QR code" /> : <div style={{ width: 220, height: 220 }} />}
              <a href={uri} data-testid="worldid-open-app" style={{ fontWeight: 600 }}>
                Open World App
              </a>
              <span>{status === "confirming" ? "Verifying…" : "Waiting for World App…"}</span>
            </>
          )}
          <button type="button" onClick={cancel} data-testid="worldid-cancel">
            Cancel
          </button>
        </div>
      )}
    </>
  );
}

const panel = {
  display: "grid",
  justifyItems: "center",
  gap: 12,
  padding: 16,
  border: "1px solid rgba(30, 58, 95, 0.25)",
  borderRadius: 2,
  textAlign: "center",
} as const;
