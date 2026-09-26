// Small app-level pieces on top of @soapay/ui (Direction A · Ledger). Presentational only.
import type { ReactNode } from "react";
import { fmtAmount, short } from "@soapay/sdk";
import { USDC_DECIMALS } from "../lib/amount.js";

export { short };

/** 4,200.00 */
export const usdc = (v: bigint): string => fmtAmount(v, USDC_DECIMALS);

export type NoticeTone = "info" | "warn" | "danger" | "ok";

export function Notice({ tone = "info", children, role }: { tone?: NoticeTone; children: ReactNode; role?: "alert" | "status" }) {
  return (
    <div className={`notice notice-${tone}`} role={role ?? (tone === "danger" ? "alert" : undefined)}>
      {children}
    </div>
  );
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export const errText = (e: unknown): string => {
  const m = (e as { shortMessage?: string }).shortMessage ?? (e instanceof Error ? e.message : String(e));
  return m.split("\n")[0] ?? m;
};
