import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CredentialRequest,
  IDKitErrorCodes,
  IDKitSessionWidget,
  type ConstraintNode,
  type IDKitResultSession,
  type RpContext,
} from "@worldcoin/idkit";

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
 * Wraps IDKit 4.3's `IDKitSessionWidget` with the Selfie Check credential.
 */
export function HumanCheck(props: HumanCheckProps) {
  const { mode, apiUrl, sessionId, signal, onResult, onCancel, onError, actionDescription } = props;
  const controlled = props.open !== undefined;
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlled ? !!props.open : innerOpen;
  const [ctx, setCtx] = useState<RpContextResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const cbs = useRef({ onCancel, onError, onOpenChange: props.onOpenChange });
  cbs.current = { onCancel, onError, onOpenChange: props.onOpenChange };

  const setOpen = useCallback(
    (v: boolean) => {
      if (!controlled) setInnerOpen(v);
      cbs.current.onOpenChange?.(v);
      if (!v) setCtx(null); // every request gets a fresh RP context
    },
    [controlled],
  );

  // A fresh RP context each time the widget opens.
  useEffect(() => {
    if (!open || ctx) return;
    if (mode === "rotate" && !sessionId) {
      cbs.current.onError?.(new HumanCheckError("no_session", "this name has no World ID session to prove"));
      setOpen(false);
      return;
    }
    let live = true;
    setLoading(true);
    fetchRpContext(apiUrl, props.fetch)
      .then((c) => live && setCtx(c))
      .catch((e: unknown) => {
        if (!live) return;
        cbs.current.onError?.(e instanceof HumanCheckError ? e : new HumanCheckError("unknown", String(e)));
        setOpen(false);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [open, ctx, mode, sessionId, apiUrl, props.fetch, setOpen]);

  return (
    <>
      {!controlled && (
        <button type="button" onClick={() => setOpen(true)} disabled={open || loading}>
          {props.children ?? (mode === "rotate" ? "Confirm it's you with World ID" : "Protect with World ID")}
        </button>
      )}
      {ctx && (
        <IDKitSessionWidget
          open={open}
          onOpenChange={(v) => {
            if (!v) {
              setOpen(false);
            }
          }}
          app_id={ctx.app_id}
          rp_context={ctx.rp_context}
          environment={ctx.environment}
          constraints={selfieCheckConstraint(signal)}
          {...(mode === "rotate" && sessionId ? { existing_session_id: sessionId } : {})}
          {...(actionDescription ? { action_description: actionDescription } : {})}
          onSuccess={async (result) => {
            await onResult(result);
          }}
          onError={(code) => {
            if (CANCEL_CODES.has(code)) cbs.current.onCancel?.();
            else cbs.current.onError?.(new HumanCheckError(code, `World ID failed: ${code}`));
          }}
        />
      )}
    </>
  );
}
