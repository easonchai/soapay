/** When the Send screen should offer the exit, and what it hands the Exit screen (pure). */
import type { SpendPlan } from "@soapay/sdk";
import type { Address } from "viem";

/** The guard flagged the destination as identifiable (main wallet, exchange, …): offer the exit. */
export function offersExit(plan: SpendPlan | null): boolean {
  return plan !== null && plan.identifiable && plan.warnings.some((w) => w.code === "identifiable-destination");
}

/** Router state for `/exit`, prefilled from a blocked send. */
export type ExitPrefill = { destination: Address; sources: Address[] };

export function exitPrefill(state: unknown): ExitPrefill | null {
  const s = state as Partial<ExitPrefill> | null;
  if (!s || typeof s.destination !== "string" || !Array.isArray(s.sources)) return null;
  return { destination: s.destination as Address, sources: s.sources.filter((a): a is Address => typeof a === "string") };
}
