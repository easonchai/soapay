// Demo mode's sample data: six pinned employees and two completed past runs, built with the real
// planning code (planRun → attemptFromPlan) so History and the run detail render exactly what a real
// run would have recorded. Pins come from the mock resolver, so "Resolve names" passes on them.
import { hexToBytes, keccak256, stringToHex } from "viem";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import type { AppConfig } from "../config.js";
import type { DemoLedger } from "./demoChain.js";
import { mockMetaFor, mockRegistrantFor } from "./resolver.js";
import type { Employee } from "./roster.js";
import { attemptFromPlan, planRun, type RunRecord } from "./run.js";

export const DEMO_EMPLOYEES: readonly { name: string; label: string; usdc: number }[] = [
  { name: "alice", label: "Alice · engineering", usdc: 4_200 },
  { name: "bram", label: "Bram · design", usdc: 3_850 },
  { name: "chen", label: "Chen · engineering", usdc: 5_100 },
  { name: "dana", label: "Dana · product", usdc: 4_200 },
  { name: "eko", label: "Eko · operations", usdc: 3_600 },
  { name: "farah", label: "Farah · support", usdc: 2_950 },
];

const DAY = 86_400_000;
/** Company default chunk (Settings), exact mode: whole chunks plus one smaller final line. */
const SEED_CHUNK = 500_000_000n;

export function demoEmployees(now = Date.now()): Employee[] {
  return DEMO_EMPLOYEES.map((e, i) => {
    const ensName = `${e.name}.soapay.eth`;
    const pinnedAt = now - (90 - i) * DAY;
    const metaAddressURI = mockMetaFor(ensName, 0);
    const registrant = mockRegistrantFor(ensName);
    return {
      id: `demo-${e.name}`,
      ensName,
      label: e.label,
      amount: BigInt(e.usdc) * 1_000_000n,
      pin: { metaAddressURI, registrant, pinnedAt },
      pinHistory: [{ metaAddressURI, registrant, at: pinnedAt, reason: "enrolled" }],
      carry: 0n,
      active: true,
    };
  });
}

/** Deterministic ephemeral keys, so a reload rebuilds the same past runs (same stealth addresses). */
function seededKeys(seed: string): () => Uint8Array {
  let i = 0;
  return () => {
    for (;;) {
      const k = hexToBytes(keccak256(stringToHex(`soapay-demo:${seed}:${i++}`)));
      if (secp256k1.utils.isValidSecretKey(k)) return k;
    }
  };
}

function pastRun(
  app: Pick<AppConfig, "chainId" | "usdc" | "stealthDisperse">,
  employees: readonly Employee[],
  opts: { id: string; label: string; createdAt: number; payer: `0x${string}`; ledger: DemoLedger },
): RunRecord {
  const plan = planRun(
    employees.map((e) => ({ employeeId: e.id, name: e.label ? `${e.label} (${e.ensName})` : e.ensName, metaAddressURI: e.pin.metaAddressURI, amount: e.amount })),
    { chunkSize: SEED_CHUNK, mode: "exact" },
    { randomEphemeralKey: seededKeys(opts.id) },
  );
  const attempt = attemptFromPlan(plan, 0, opts.createdAt);
  return {
    id: opts.id,
    createdAt: opts.createdAt,
    label: opts.label,
    chainId: app.chainId,
    path: "disperse",
    token: app.usdc,
    payer: opts.payer,
    ...(app.stealthDisperse ? { stealthDisperse: app.stealthDisperse } : {}),
    denomination: plan.denomination,
    carryOut: {},
    carryCommitted: false,
    excluded: [],
    attempts: [
      {
        ...attempt,
        approve: { amount: plan.total, status: "landed", txHash: opts.ledger.nextTxHash() },
        chunks: attempt.chunks.map((c) => ({ ...c, status: "landed" as const, txHash: opts.ledger.nextTxHash() })),
      },
    ],
  };
}

/** Two completed payrolls, newest first, paid by the demo wallet. */
export function demoRuns(
  app: Pick<AppConfig, "chainId" | "usdc" | "stealthDisperse">,
  employees: readonly Employee[],
  payer: `0x${string}`,
  ledger: DemoLedger,
  now = Date.now(),
): RunRecord[] {
  return [
    pastRun(app, employees, { id: "demo-run-august", label: "August payroll", createdAt: now - 29 * DAY, payer, ledger }),
    pastRun(app, employees, { id: "demo-run-july", label: "July payroll", createdAt: now - 60 * DAY, payer, ledger }),
  ];
}
