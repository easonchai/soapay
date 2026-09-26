import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CredentialRequest, IDKit, IDKitErrorCodes, setDebug, type ConstraintNode, type IDKitRequest } from "@worldcoin/idkit-core";
import QRCode from "qrcode";
import type { IDKitResultSession, RpContext } from "@worldcoin/idkit";

export type { IDKitResultSession } from "@worldcoin/idkit";

/**
 * World ID sessions (D-59, which restores D-16/D-57 and supersedes D-58):
 * - `create-session`: create a new World ID session (at enrollment, or to link one later).
 *   The API stores the session id for the name.
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
   * `rotationSignal(label, newMeta, deadline)` to rotate (both from `@soapay/sdk`). It isn't
   * sent to World App (D-57): the API binds it to the single-use RP nonce instead.
   */
  signal: string;
  /** The IDKit session result. Send it to the API unchanged (`worldIdSession` / `worldIdResult`). */
  onResult: (result: IDKitResultSession) => void | Promise<void>;
  /** The user closed the panel or declined in World App. */
  onCancel?: () => void;
  /** Anything else: the API couldn't sign an RP context, or World App returned an error. */
  onError?: (error: HumanCheckError) => void;
  /** Controlled open state. Omit it to render a button that opens the panel. */
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

/** The World ID credential Soapay asks for (Proof of Human, D-54). Keep in sync with `WORLD_ID_CREDENTIAL` in @soapay/sdk. */
export const HUMAN_CHECK_CREDENTIAL = "proof_of_human" as const;

/**
 * The required credential as a session constraint. IDKit 4.3 rejects presets for session
 * requests ("Use .constraints() instead"), although World's session docs show `.preset(...)`.
 */
export function humanCheckConstraint(_signal?: string): ConstraintNode {
  // No signal (D-57): World App stalls on session requests that carry one. The API binds the
  // proof to our signal through the RP nonce instead (`bind`).
  return CredentialRequest(HUMAN_CHECK_CREDENTIAL, {});
}

/** POST {apiUrl}/worldid/rp-context: a fresh, single-use RP signature for one session request, bound to `bind`. */
export async function fetchRpContext(apiUrl: string, f: typeof fetch = fetch, bind?: string): Promise<RpContextResponse> {
  let res: Response;
  try {
    res = await f(`${apiUrl.replace(/\/+$/, "")}/worldid/rp-context`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bind ? { kind: "session", bind } : { kind: "session" }),
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
 * World ID check for Soapay's single trust moment: account recovery (docs/worldid.md).
 *
 * Builds the session request with IDKit core, `IDKit.createSession(...)` or
 * `IDKit.proveSession(sessionId, ...)`, both `.constraints(CredentialRequest("proof_of_human", {}))`,
 * and renders its QR code inline inside the app's own screen (no pop-up). On failure IDKit's
 * debug report (the request and World App's raw response) is kept for "Copy details".
 */
export function HumanCheck(props: HumanCheckProps) {
  const { mode, apiUrl, sessionId, signal, onResult, actionDescription } = props;
  const controlled = props.open !== undefined;
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlled ? !!props.open : innerOpen;
  const [ctx, setCtx] = useState<RpContextResponse | null>(null);
  const [debug, setDebugText] = useState<string | null>(null);
  const cbs = useRef({ onCancel: props.onCancel, onError: props.onError, onOpenChange: props.onOpenChange, onResult });
  cbs.current = { onCancel: props.onCancel, onError: props.onError, onOpenChange: props.onOpenChange, onResult };
  const pendingError = useRef<HumanCheckError | null>(null);

  const setOpen = useCallback(
    (v: boolean) => {
      if (!controlled) setInnerOpen(v);
      cbs.current.onOpenChange?.(v);
      if (!v) setCtx(null); // every request gets a fresh, single-use RP context
    },
    [controlled],
  );

  // A fresh RP context, bound to this signal, each time the check opens.
  useEffect(() => {
    if (!open || ctx) return;
    if (mode === "rotate" && !sessionId) {
      cbs.current.onError?.(new HumanCheckError("no_session", "this name has no World ID session to prove"));
      setOpen(false);
      return;
    }
    setDebug(true); // keeps IDKit's debug report; nothing secret is in it
    setDebugText(null);
    pendingError.current = null;
    let live = true;
    fetchRpContext(apiUrl, props.fetch, signal)
      .then((c) => live && setCtx(c))
      .catch((e: unknown) => {
        if (!live) return;
        cbs.current.onError?.(e instanceof HumanCheckError ? e : new HumanCheckError("start_failed", `World ID failed to start: ${String(e)}`));
        setOpen(false);
      });
    return () => {
      live = false;
    };
  }, [open, ctx, mode, sessionId, apiUrl, signal, props.fetch, setOpen]);

  const close = () => {
    const err = pendingError.current;
    pendingError.current = null;
    setDebugText(null);
    if (err) cbs.current.onError?.(err);
    else cbs.current.onCancel?.();
    setOpen(false);
  };

  // Build the session request ourselves and show its QR inline (no pop-up), then poll World.
  const [uri, setUri] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!open || !ctx) return;
    let live = true;
    const ac = new AbortController();
    setUri(null);
    setQr(null);
    setConfirming(false);
    void (async () => {
      let request: IDKitRequest;
      try {
        const config = {
          app_id: ctx.app_id,
          rp_context: ctx.rp_context,
          environment: ctx.environment,
          ...(actionDescription ? { action_description: actionDescription } : {}),
        };
        const builder = mode === "rotate" && sessionId ? IDKit.proveSession(sessionId, config) : IDKit.createSession(config);
        request = await builder.constraints(humanCheckConstraint());
      } catch (e) {
        if (!live) return;
        cbs.current.onError?.(new HumanCheckError("start_failed", `World ID failed to start: ${String(e)}`));
        setOpen(false);
        return;
      }
      if (!live) return;
      setUri(request.connectorURI);
      QRCode.toDataURL(request.connectorURI, { width: 220, margin: 1, errorCorrectionLevel: "M" })
        .then((d) => live && setQr(d))
        .catch(() => undefined);
      const done = await request
        .pollUntilCompletion({ signal: ac.signal, timeout: 300_000 })
        .catch(() => ({ success: false as const, error: IDKitErrorCodes.Cancelled }));
      if (!live) return;
      if (done.success) {
        setConfirming(true);
        try {
          await cbs.current.onResult(done.result as IDKitResultSession);
        } finally {
          setOpen(false);
        }
        return;
      }
      if (CANCEL_CODES.has(done.error)) {
        close();
        return;
      }
      pendingError.current = new HumanCheckError(done.error, `World ID failed: ${done.error}`);
      let text = "";
      try {
        text = JSON.stringify(request.getDebugReport() ?? null, null, 2);
      } catch {
        text = "(no debug report)";
      }
      setDebugText(`error: ${done.error}\n${text}`);
    })();
    return () => {
      live = false;
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ctx]);

  return (
    <>
      {!controlled && (
        <button type="button" onClick={() => setOpen(true)} disabled={open}>
          {props.children ?? (mode === "rotate" ? "Confirm it's you with World ID" : "Protect with World ID")}
        </button>
      )}
      {open && !debug && (
        <div aria-label="Verify with World ID" data-testid="worldid-panel" style={panel}>
          <strong>{mode === "rotate" ? "Confirm it's you" : "Link World ID"}</strong>
          <span style={{ fontSize: 13, opacity: 0.8 }}>Scan with your phone camera to open the World ID app, then approve Proof of Human.</span>
          {qr ? <img src={qr} width={220} height={220} alt="World ID QR code" /> : <div style={{ width: 220, height: 220 }} aria-busy />}
          {uri && (
            <a href={uri} data-testid="worldid-open-app" style={{ fontWeight: 600 }}>
              On this phone? Open the World ID app
            </a>
          )}
          <span style={{ fontSize: 13, opacity: 0.8 }}>{confirming ? "Verifying…" : uri ? "Waiting for the World ID app…" : "Preparing…"}</span>
          <button type="button" onClick={close} data-testid="worldid-cancel">
            Cancel
          </button>
        </div>
      )}
      {open && debug && (
        <div role="dialog" aria-label="World ID error" data-testid="worldid-panel" style={panel}>
          <strong>World App returned an error</strong>
          <span>Copy the details and send them to the team.</span>
          <textarea readOnly value={debug} rows={6} style={{ width: "100%", fontFamily: "monospace", fontSize: 11 }} data-testid="worldid-debug" />
          <button type="button" onClick={() => void navigator.clipboard?.writeText(debug).catch(() => undefined)}>
            Copy details
          </button>
          <button type="button" onClick={close} data-testid="worldid-cancel">
            Close
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

/** @deprecated Renamed to `humanCheckConstraint` (the credential is now Proof of Human, D-54). */
export const selfieCheckConstraint = humanCheckConstraint;
