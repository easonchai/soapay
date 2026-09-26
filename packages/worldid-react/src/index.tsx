import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  IDKitErrorCodes,
  IDKitRequestWidget,
  proofOfHuman,
  setDebug,
  type IDKitResult,
  type Preset,
  type RpContext,
} from "@worldcoin/idkit";

export type { IDKitResult } from "@worldcoin/idkit";

/**
 * Both modes run the same one-time Proof of Human request on the recovery action (D-58); they
 * differ in what the API does with the proof:
 * - `create-session`: link World ID to a name (at enrollment, or later). The API stores the
 *   proof's nullifier. The name is historical: World ID sessions are no longer used.
 * - `rotate`: prove it's still you. The API accepts it only with the same nullifier.
 */
export type HumanCheckMode = "create-session" | "rotate";

export type HumanCheckProps = {
  mode: HumanCheckMode;
  /** Soapay API base URL, e.g. `https://api.soapay.xyz`. The RP context is signed there. */
  apiUrl: string;
  /** @deprecated Ignored since D-58 (rotation matches the nullifier server-side). Kept for old callers. */
  sessionId?: string | undefined;
  /**
   * The signal the API expects: `sessionSignal(label, registrant)` to link World ID,
   * `rotationSignal(label, newMeta, deadline)` to rotate (both from `@soapay/sdk`).
   */
  signal: string;
  /** The IDKit result. Send it to the API unchanged (`worldIdSession` / `worldIdResult`). */
  onResult: (result: IDKitResult) => void | Promise<void>;
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
  /** The World ID action the RP context was signed for (the API's WORLD_ACTION). */
  action?: string;
};

/** The World ID credential Soapay asks for (Proof of Human, D-54). Keep in sync with `WORLD_ID_CREDENTIAL` in @soapay/sdk. */
export const HUMAN_CHECK_CREDENTIAL = "proof_of_human" as const;
/** Default recovery action (D-58). Keep in sync with `WORLD_ID_ACTION` in @soapay/sdk; the API's value wins. */
export const HUMAN_CHECK_ACTION = "soapay-recovery" as const;

/** The IDKit preset for one Soapay proof: Proof of Human, bound to `signal`. */
export function humanCheckPreset(signal?: string): Preset {
  return proofOfHuman(signal ? { signal } : {});
}

/** POST {apiUrl}/worldid/rp-context: a fresh, single-use RP signature for one Proof of Human request. */
export async function fetchRpContext(apiUrl: string, f: typeof fetch = fetch, bind?: string): Promise<RpContextResponse> {
  let res: Response;
  try {
    res = await f(`${apiUrl.replace(/\/+$/, "")}/worldid/rp-context`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bind ? { kind: "uniqueness", bind } : { kind: "uniqueness" }),
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
 * Uses IDKit's own `IDKitRequestWidget`, configured like World's integration docs: a one-time
 * request on the recovery action, `allow_legacy_proofs={false}`, the API's `environment`, and
 * `preset={proofOfHuman({ signal })}`. The server also binds the proof to the signal through
 * the RP nonce (`bind`, D-57). On failure the widget's debug report (the request and World
 * App's raw response) is kept for "Copy details".
 */
export function HumanCheck(props: HumanCheckProps) {
  const { mode, apiUrl, signal, onResult, actionDescription } = props;
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
  }, [open, ctx, apiUrl, signal, props.fetch, setOpen]);

  const close = () => {
    const err = pendingError.current;
    pendingError.current = null;
    setDebugText(null);
    if (err) cbs.current.onError?.(err);
    else cbs.current.onCancel?.();
    setOpen(false);
  };

  return (
    <>
      {!controlled && (
        <button type="button" onClick={() => setOpen(true)} disabled={open}>
          {props.children ?? (mode === "rotate" ? "Confirm it's you with World ID" : "Protect with World ID")}
        </button>
      )}
      {ctx && !debug && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={(v) => {
            if (!v && !pendingError.current) close();
          }}
          app_id={ctx.app_id}
          action={ctx.action ?? HUMAN_CHECK_ACTION}
          rp_context={ctx.rp_context}
          allow_legacy_proofs={false}
          environment={ctx.environment}
          preset={humanCheckPreset(signal)}
          {...(actionDescription ? { action_description: actionDescription } : {})}
          onSuccess={async (result) => {
            try {
              await cbs.current.onResult(result);
            } finally {
              setOpen(false);
            }
          }}
          onError={(code, report) => {
            if (CANCEL_CODES.has(code)) {
              close();
              return;
            }
            // Keep the details readable; the error is reported when the user closes the panel.
            pendingError.current = new HumanCheckError(code, `World ID failed: ${code}`);
            let text = "";
            try {
              text = JSON.stringify(report ?? null, null, 2);
            } catch {
              text = "(no debug report)";
            }
            setDebugText(`error: ${code}\n${text}`);
          }}
        />
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
