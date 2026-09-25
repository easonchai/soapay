/**
 * Compliant exit through Privacy Pools (docs/mvp-spec.md §9, research in docs/exit-research.md).
 *
 * One `ExitLeg` per stealth address, never combined:
 *
 *   planned ─burn→ burning ─attested→ awaiting-mint ─minted→ minted ─deposit→ depositing
 *     → pending-asp ─┬→ approved ─withdraw→ withdrawing ─→ done (or back to approved for the next part)
 *                    └→ declined ─ragequit→ refunded
 *
 * - Bridge: CCTP V2 `depositForBurnWithHook` from the stealth address (approve + burn in one 7702 userOp,
 *   gas in USDC via the Circle paymaster). The mint recipient is the SAME stealth address on the
 *   destination, and Circle's Forwarding Service submits the mint, so the address never needs ETH.
 * - Deposit: approve + `Entrypoint.deposit` from the stealth address on the destination (same path).
 * - Withdraw: a Groth16 proof (0xbow SDK) relayed by the 0xbow relayer to `destination`; the relayer
 *   pays gas and takes its fee from the withdrawn amount.
 * - Declined: `PrivacyPool.ragequit` from the stealth address returns the funds to it, publicly.
 *
 * `advanceExitLeg` is an idempotent, resumable step machine: each call does at most one transition
 * and returns the new leg, which is plain JSON (bigints as decimal strings) for the encrypted vault.
 *
 * `@0xbow/privacy-pools-core-sdk` (Poseidon, Merkle proofs, snarkjs proving) is ~3.5 MB of JS, so it
 * is lazy-imported on first use. It is plain-Node safe (checked on Node 24). Circuit artifacts
 * (~20 MB, not in the npm package) are fetched from `config.circuitsBaseUrl` (privacypools.com, CORS
 * open) and hash-checked by the SDK, in Node and the browser alike. For offline Node use, point
 * `circuitsBaseUrl` at a `file://` directory holding `artifacts/` and set `circuitsFromFs: true`.
 */
import {
  decodeAbiParameters,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isAddressEqual,
  pad,
  parseAbi,
  parseAbiParameters,
  keccak256,
  encodePacked,
  hexToBigInt,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { ENTRYPOINT_V08, getSpendChainConfig } from "./constants.js";
import {
  estimateExecute,
  executeFromStealth,
  type ExecuteParams,
  type ExecuteResult,
  type SpendClient,
  type SpendOptions,
  type StealthCall,
} from "./spend.js";

// ---------------------------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------------------------

export type CctpDomainConfig = { domain: number; tokenMessenger: Address; messageTransmitter: Address; usdc: Address };

export type ExitConfig = {
  source: number;
  dest: number;
  cctp: {
    source: CctpDomainConfig;
    dest: CctpDomainConfig;
    /** Circle Iris API (attestations, fee quotes). */
    irisApiUrl: string;
    /** 1000 = fast (seconds, ~1.3 bps), 2000 = standard (finality, free). */
    minFinalityThreshold: 1000 | 2000;
    /** Forwarding Service fee tier used for `maxFee`. Excess becomes the destination priority fee. */
    forwardFeeTier: "low" | "med" | "high";
  };
  pool: {
    entrypoint: Address;
    pool: Address;
    asset: Address;
    /** `PrivacyPool.SCOPE()`. */
    scope: bigint;
    /** `Entrypoint.assetConfig(asset).minimumDepositAmount`. */
    minDeposit: bigint;
    /** `assetConfig(asset).vettingFeeBPS`: taken from the deposit on entry. */
    vettingFeeBps: bigint;
  };
  aspApiUrl: string;
  relayerUrl: string;
  forwarding: true;
  /** Base URL serving `artifacts/withdraw.{wasm,zkey,vkey}` and `artifacts/commitment.*`. */
  circuitsBaseUrl: string;
  /** Random delay before each withdrawal (privacy: decorrelate from the ASP root update). */
  withdrawDelayMs: { min: number; max: number };
  /** Round unit for partial withdrawals (base units). */
  withdrawUnit: bigint;
  /** USDC kept on the destination stealth address after deposit, to pay a ragequit's gas if declined. */
  ragequitReserve: bigint;
  /** Rough planning estimates for `planExit` (the real fees are quoted at each step). */
  estimates: { sourceGas: bigint; destGas: bigint; forwardFee: bigint; relayFeeBps: bigint };
};

/** Forwarding Service v0 hook data: "cctp-forward" (bytes24) | version 0 | length 0. */
export const CCTP_FORWARD_HOOK_DATA: Hex = "0x636374702d666f72776172640000000000000000000000000000000000000000";

/** Field modulus of BN254; Privacy Pools nullifiers and secrets live below it. */
export const SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Base Sepolia → Ethereum Sepolia (0xbow USDC pool). Every address checked with eth_getCode on
 * 2026-09-25; pool parameters read with `assetConfig(USDC)` and `SCOPE()`.
 */
export const EXIT_BASE_SEPOLIA_TO_SEPOLIA: ExitConfig = {
  source: 84532,
  dest: 11155111,
  cctp: {
    source: {
      domain: 6,
      tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
      messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
      usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    },
    dest: {
      domain: 0,
      tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
      messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
      usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    },
    irisApiUrl: "https://iris-api-sandbox.circle.com",
    minFinalityThreshold: 1000,
    forwardFeeTier: "med",
  },
  pool: {
    entrypoint: "0x34A2068192b1297f2a7f85D7D8CdE66F8F0921cB",
    pool: "0x0b062Fe33c4f1592D8EA63f9a0177FcA44374C0f",
    asset: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    scope: 18021368285297593722986850677939473668942851500120722179451099768921996600282n,
    minDeposit: 10_000_000n,
    vettingFeeBps: 100n,
  },
  aspApiUrl: "https://dw.0xbow.io",
  relayerUrl: "https://testnet-relayer.privacypools.com",
  forwarding: true,
  circuitsBaseUrl: "https://privacypools.com/",
  withdrawDelayMs: { min: 60 * 60_000, max: 24 * 60 * 60_000 },
  withdrawUnit: 1_000_000n,
  // Testnet: 0, because faucet funds are scarce and the testnet ASP approves ordinary deposits.
  // Production should reserve roughly one ragequit's gas.
  ragequitReserve: 0n,
  estimates: { sourceGas: 50_000n, destGas: 1_500_000n, forwardFee: 1_810_000n, relayFeeBps: 10n },
};

export const EXIT_CONFIGS: Record<string, ExitConfig> = {
  "84532:11155111": EXIT_BASE_SEPOLIA_TO_SEPOLIA,
};

export function getExitConfig(source: number, dest: number): ExitConfig {
  const c = EXIT_CONFIGS[`${source}:${dest}`];
  if (!c) throw new Error(`Soapay exit: no route ${source} → ${dest}`);
  return c;
}

// ---------------------------------------------------------------------------------------------
// ABIs
// ---------------------------------------------------------------------------------------------

export const tokenMessengerV2Abi = parseAbi([
  "function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)",
]);
export const messageTransmitterV2Abi = parseAbi([
  "function usedNonces(bytes32 nonce) view returns (uint256)",
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
  "event MessageReceived(address indexed caller, uint32 sourceDomain, bytes32 indexed nonce, bytes32 sender, uint32 indexed finalityThresholdExecuted, bytes messageBody)",
]);
export const ppEntrypointAbi = parseAbi([
  "function deposit(address asset, uint256 value, uint256 precommitment) returns (uint256)",
  "function latestRoot() view returns (uint256)",
]);
export const ppPoolAbi = parseAbi([
  "function ragequit((uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[4] pubSignals) proof)",
  "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitmentHash)",
  "event Withdrawn(address indexed _processooor, uint256 _value, uint256 _spentNullifier, uint256 _newCommitment)",
  "event Ragequit(address indexed _ragequitter, uint256 _commitment, uint256 _label, uint256 _value)",
]);
const entryPointNonceAbi = parseAbi([
  "function getNonce(address sender, uint192 key) view returns (uint256)",
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
]);

// ---------------------------------------------------------------------------------------------
// Leg state (plain JSON)
// ---------------------------------------------------------------------------------------------

export type ExitStatus =
  | "planned"
  | "burning"
  | "awaiting-mint"
  | "minted"
  | "depositing"
  | "pending-asp"
  | "approved"
  | "declined"
  | "withdrawing"
  | "done"
  | "refunded"
  | "failed";

/** Amounts are base-unit decimal strings so the leg survives JSON.stringify/parse unchanged. */
export type ExitLeg = {
  id: string;
  stealthAddress: Address;
  /** USDC to exit from the stealth address on the source chain. The burn is capped by balance − gas. */
  amount: string;
  /** Final recipient of the withdrawals. */
  destination: Address;
  source: number;
  dest: number;
  status: ExitStatus;
  txs: { burn?: Hash; mint?: Hash; deposit?: Hash; withdraw?: Hash; refund?: Hash };
  poolIndex: number;
  error?: string;
  updatedAt: number;
  /** The burn as sent: amount burned and the CCTP maxFee. */
  burn?: { amount: string; maxFee: string };
  /** Attested CCTP message; kept so anyone can call `receiveMessage` if forwarding fails. */
  cctp?: { nonce: Hex; message: Hex; attestation: Hex; forwardState?: string };
  mint?: { amount: string };
  deposit?: { amount: string; label: string; value: string; commitment: string; precommitment: string };
  asp?: { status: "pending" | "approved" | "declined"; checkedAt: number };
  /** Planned withdrawal amounts (round parts), in order. */
  withdrawPlan?: string[];
  /** Completed or in-flight withdrawals. `child` is the commitment index being spent (0 = deposit). */
  withdrawals: { amount: string; child: number; tx?: Hash; done?: boolean }[];
  /** Value still in the pool. */
  remaining?: string;
  /** Earliest time (ms) the next withdrawal may go out. */
  notBefore?: number;
  /** A userOp handed to the bundler whose outcome is not recorded yet (crash between send and save). */
  pending?: { step: "burn" | "deposit" | "refund"; chainId: number; sender: Address; nonce: string };
};

const bi = (s: string | undefined): bigint => BigInt(s ?? "0");

// ---------------------------------------------------------------------------------------------
// Pool secrets
// ---------------------------------------------------------------------------------------------

export type PoolSecrets = { nullifier: bigint; secret: bigint };

function fieldElement(label: string, spendingKey: Hex, poolIndex: number, child: number): bigint {
  for (let ctr = 0; ctr < 256; ctr++) {
    const h = hexToBigInt(
      keccak256(encodePacked(["string", "bytes32", "uint32", "uint32", "uint8"], [label, spendingKey, poolIndex, child, ctr])),
    );
    // Reduce with rejection so the distribution stays uniform below the field.
    const max = (1n << 256n) - ((1n << 256n) % SNARK_SCALAR_FIELD);
    if (h < max) {
      const v = h % SNARK_SCALAR_FIELD;
      if (v !== 0n) return v;
    }
  }
  throw new Error("Soapay exit: secret derivation failed");
}

/**
 * Deterministic Privacy Pools secrets for exit `poolIndex`, domain-separated keccak of the spending
 * key (which the seed phrase recovers), so a lost device re-derives every in-flight exit.
 * `child` 0 is the deposit commitment; child n ≥ 1 is the change commitment after the n-th withdrawal.
 * Never reuse a poolIndex for two deposits (it would reuse the nullifier).
 */
export function derivePoolSecrets(keys: { spendingKey: Hex }, poolIndex: number, child = 0): PoolSecrets {
  if (!Number.isInteger(poolIndex) || poolIndex < 0 || poolIndex > 0xffffffff) throw new Error("Soapay exit: bad poolIndex");
  if (!Number.isInteger(child) || child < 0 || child > 0xffffffff) throw new Error("Soapay exit: bad child index");
  return {
    nullifier: fieldElement("soapay.exit.privacy-pools.nullifier.v1", keys.spendingKey, poolIndex, child),
    secret: fieldElement("soapay.exit.privacy-pools.secret.v1", keys.spendingKey, poolIndex, child),
  };
}

// ---------------------------------------------------------------------------------------------
// Lazy 0xbow SDK
// ---------------------------------------------------------------------------------------------

type PPModule = typeof import("@0xbow/privacy-pools-core-sdk");
let ppModule: Promise<PPModule> | undefined;
/** Lazy import of `@0xbow/privacy-pools-core-sdk` (large; loaded only when an exit needs it). */
export function loadPrivacyPoolsSdk(): Promise<PPModule> {
  ppModule ??= import("@0xbow/privacy-pools-core-sdk");
  return ppModule;
}

export type Groth16 = { proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[] }; publicSignals: string[] };

/** Proof generation, injectable for tests. The default uses the 0xbow SDK with fetched artifacts. */
export type ExitProver = {
  proveWithdrawal(commitment: { value: bigint; label: bigint; nullifier: bigint; secret: bigint; hash: bigint }, input: WithdrawalProofInputs): Promise<Groth16>;
  proveCommitment(value: bigint, label: bigint, nullifier: bigint, secret: bigint): Promise<Groth16>;
};

export type WithdrawalProofInputs = {
  context: bigint;
  withdrawalAmount: bigint;
  stateMerkleProof: { root: bigint; leaf: bigint; index: number; siblings: bigint[] };
  aspMerkleProof: { root: bigint; leaf: bigint; index: number; siblings: bigint[] };
  stateRoot: bigint;
  stateTreeDepth: bigint;
  aspRoot: bigint;
  aspTreeDepth: bigint;
  newSecret: bigint;
  newNullifier: bigint;
};

const provers = new Map<string, ExitProver>();
/**
 * The 0xbow SDK prover. `fromFs` loads artifacts with fs (Node only, `baseUrl` a file:// URL);
 * otherwise they are fetched, which works in the browser and in Node ≥ 18.
 */
export function privacyPoolsProver(baseUrl: string, fromFs = false): ExitProver {
  const key = `${baseUrl}|${fromFs}`;
  const cached = provers.get(key);
  if (cached) return cached;
  let sdk: Promise<InstanceType<PPModule["PrivacyPoolSDK"]>> | undefined;
  const get = () =>
    (sdk ??= loadPrivacyPoolsSdk().then((m) => new m.PrivacyPoolSDK(new m.Circuits({ baseUrl, browser: !fromFs }))));
  const p: ExitProver = {
    async proveWithdrawal(c, input) {
      const s = await get();
      const commitment = {
        hash: c.hash,
        nullifierHash: 0n,
        preimage: { value: c.value, label: c.label, precommitment: { hash: 0n, nullifier: c.nullifier, secret: c.secret } },
      };
      return (await s.proveWithdrawal(commitment as never, input as never)) as unknown as Groth16;
    },
    async proveCommitment(value, label, nullifier, secret) {
      const s = await get();
      return (await s.proveCommitment(value, label, nullifier, secret)) as unknown as Groth16;
    },
  };
  provers.set(key, p);
  return p;
}

/** Proof tuple in the on-chain order (pB coordinates swapped), as the 0xbow SDK formats it. */
export function formatGroth16(p: Groth16) {
  const n = (v: string | undefined) => BigInt(v ?? "0");
  return {
    pA: [n(p.proof.pi_a[0]), n(p.proof.pi_a[1])] as const,
    pB: [
      [n(p.proof.pi_b[0]?.[1]), n(p.proof.pi_b[0]?.[0])],
      [n(p.proof.pi_b[1]?.[1]), n(p.proof.pi_b[1]?.[0])],
    ] as const,
    pC: [n(p.proof.pi_c[0]), n(p.proof.pi_c[1])] as const,
    pubSignals: p.publicSignals.map((s) => BigInt(s)),
  };
}

// ---------------------------------------------------------------------------------------------
// Fees and planning
// ---------------------------------------------------------------------------------------------

export type CctpFeeRow = { finalityThreshold: number; minimumFee: number; forwardFee?: { low: number; med: number; high: number } };

/** CCTP `maxFee` = protocol fee (minimumFee bps, rounded up) + the Forwarding Service fee tier. */
export function cctpMaxFee(amount: bigint, row: CctpFeeRow, tier: "low" | "med" | "high"): bigint {
  const centiBps = BigInt(Math.round(row.minimumFee * 100));
  const protocol = (amount * centiBps + 999_999n) / 1_000_000n;
  const forward = row.forwardFee ? BigInt(Math.ceil(row.forwardFee[tier])) : 0n;
  return protocol + forward;
}

/**
 * Split a pool balance into round withdrawal parts (multiples of `unit`), largest first, plus the
 * non-round remainder as a last part unless `leaveChange`. Round, repeated amounts don't match any
 * deposit; leaving the change in the pool avoids the one tell-tale odd amount.
 */
export function planRoundWithdrawals(value: bigint, opts: { unit: bigint; parts?: number; leaveChange?: boolean; min?: bigint }): bigint[] {
  const parts = BigInt(Math.max(1, opts.parts ?? 2));
  const min = opts.min ?? 1n;
  const per = (value / parts / opts.unit) * opts.unit;
  const out: bigint[] = [];
  if (per > 0n) for (let i = 0n; i < parts; i++) out.push(per);
  const rest = value - per * BigInt(out.length);
  if (rest >= min && !opts.leaveChange) out.push(rest);
  if (out.length === 0 && value >= min) out.push(value);
  return out;
}

/** Uniform random delay in [min, max] ms before a withdrawal. */
export function suggestedDelayMs(config: Pick<ExitConfig, "withdrawDelayMs">, random: () => number = Math.random): number {
  const { min, max } = config.withdrawDelayMs;
  return Math.floor(min + random() * Math.max(0, max - min));
}

export type ExitFees = {
  /** Upper-bound CCTP protocol fee at the configured finality. */
  cctpProtocolFee: bigint;
  forwardFee: bigint;
  sourceGas: bigint;
  destGas: bigint;
  vettingFee: bigint;
  relayFee: bigint;
  total: bigint;
  /** What reaches `destination` after every fee (estimate). */
  estimatedReceived: bigint;
};

export type PlanExitParams = {
  sources: { stealthAddress: Address; amount: bigint }[];
  destination: Address;
  config: ExitConfig;
  /** Next unused pool index in the recipient's vault; legs take consecutive indices. */
  firstPoolIndex?: number;
  now?: number;
};

export function planExit(p: PlanExitParams): { legs: ExitLeg[]; fees: ExitFees; warnings: string[] } {
  const { config } = p;
  const now = p.now ?? Date.now();
  const warnings: string[] = [];
  const seen = new Set<string>();
  const zero: ExitFees = { cctpProtocolFee: 0n, forwardFee: 0n, sourceGas: 0n, destGas: 0n, vettingFee: 0n, relayFee: 0n, total: 0n, estimatedReceived: 0n };
  const fees = { ...zero };
  const legs = p.sources.map((s, i): ExitLeg => {
    const stealthAddress = getAddress(s.stealthAddress);
    if (seen.has(stealthAddress)) throw new Error(`Soapay exit: ${stealthAddress} listed twice (one leg per address)`);
    seen.add(stealthAddress);
    if (s.amount <= 0n) throw new Error("Soapay exit: amount must be positive");
    const poolIndex = (p.firstPoolIndex ?? 0) + i;
    const burn = s.amount - config.estimates.sourceGas;
    const protocol = config.cctp.minFinalityThreshold === 1000 ? (burn * 13n + 99_999n) / 100_000n : 0n;
    const minted = burn - protocol - config.estimates.forwardFee;
    const deposit = minted - config.estimates.destGas - config.ragequitReserve;
    const vetting = deposit > 0n ? (deposit * config.pool.vettingFeeBps + 9_999n) / 10_000n : 0n;
    const inPool = deposit - vetting;
    const relay = inPool > 0n ? (inPool * config.estimates.relayFeeBps + 9_999n) / 10_000n : 0n;
    fees.cctpProtocolFee += protocol;
    fees.forwardFee += config.estimates.forwardFee;
    fees.sourceGas += config.estimates.sourceGas;
    fees.destGas += config.estimates.destGas;
    fees.vettingFee += vetting;
    fees.relayFee += relay;
    fees.estimatedReceived += inPool > relay ? inPool - relay : 0n;
    if (deposit < config.pool.minDeposit) {
      const short = config.pool.minDeposit - deposit;
      warnings.push(`${stealthAddress}: after bridge fees and gas about ${deposit} reaches the pool, below its ${config.pool.minDeposit} minimum (add ~${short}).`);
    }
    return {
      id: `exit-${config.source}-${config.dest}-${stealthAddress.toLowerCase()}-${poolIndex}`,
      stealthAddress,
      amount: s.amount.toString(),
      destination: getAddress(p.destination),
      source: config.source,
      dest: config.dest,
      status: "planned",
      txs: {},
      poolIndex,
      updatedAt: now,
      withdrawals: [],
    };
  });
  fees.total = fees.cctpProtocolFee + fees.forwardFee + fees.sourceGas + fees.destGas + fees.vettingFee + fees.relayFee;
  if (legs.length > 1)
    warnings.push(`${legs.length} exits to the same destination: the withdrawals link to each other (not to their deposits). Spread them over time or use separate destinations.`);
  for (const s of p.sources)
    if (s.amount % config.withdrawUnit !== 0n)
      warnings.push(`A deposit of an exact salary-sized amount can point to you in a small pool; round partial withdrawals and random delays are applied.`);
  if (config.dest === 11155111) warnings.push("Testnet pool: the anonymity set is tiny; this shows the mechanics, not privacy.");
  return { legs, fees, warnings: [...new Set(warnings)] };
}

// ---------------------------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------------------------

type FetchResponse = { ok: boolean; status: number; statusText?: string; json(): Promise<unknown>; text(): Promise<string> };
export type ExitFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<FetchResponse>;

export type ExitContext = {
  config: ExitConfig;
  /** Spend clients keyed by chain id: one for `config.source`, one for `config.dest`. */
  spendClients: Record<number, SpendClient>;
  /** The stealth private key for `leg.stealthAddress` (memory only). */
  stealthKey: Hex;
  /** Recipient keys; pool secrets derive from the spending key. Or pass `poolSecrets`. */
  keys?: { spendingKey: Hex };
  poolSecrets?: (poolIndex: number, child: number) => PoolSecrets;
  fetch?: ExitFetch;
  now?: () => number;
  random?: () => number;
  /**
   * Save the leg. Called right before a userOp goes to the bundler (with `pending` set), so a crash
   * mid-send resumes without double-sending. Strongly recommended.
   */
  persist?: (leg: ExitLeg) => void | Promise<void>;
  /** Injected for tests; default `executeFromStealth`. */
  execute?: (client: SpendClient, params: ExecuteParams, options?: SpendOptions) => Promise<ExecuteResult>;
  /** Injected for tests; default `estimateExecute`. */
  estimate?: typeof estimateExecute;
  prover?: ExitProver;
  /** Fee caps per chain id (USDC base units). Default 1 USDC source, 5 USDC destination. */
  maxFeeUsdc?: Record<number, bigint>;
  /** Blocks to scan back for logs (mint, userOp events). Default 5000. */
  logLookbackBlocks?: bigint;
  /** Fallback when the Forwarding Service fails: submit `receiveMessage` some other way (e.g. apps/api). */
  mintFallback?: (args: { message: Hex; attestation: Hex; dest: number }) => Promise<Hash | undefined>;
  /** Withdrawal split. Default 2 round parts plus change. */
  withdrawParts?: number;
  leaveChange?: boolean;
};

export class ExitError extends Error {
  override name = "ExitError";
}
/** Non-retryable: the leg moves to `failed`. */
export class ExitFatalError extends ExitError {
  override name = "ExitFatalError";
}

const env = () => globalThis as unknown as { fetch?: ExitFetch };
function fetcher(ctx: ExitContext): ExitFetch {
  const f = ctx.fetch ?? env().fetch?.bind(globalThis);
  if (!f) throw new ExitError("Soapay exit: no fetch available");
  return f;
}
const nowOf = (ctx: ExitContext) => (ctx.now ?? Date.now)();
function clientFor(ctx: ExitContext, chainId: number): SpendClient {
  const c = ctx.spendClients[chainId];
  if (!c) throw new ExitError(`Soapay exit: no spend client for chain ${chainId}`);
  return c;
}
function secretsFor(ctx: ExitContext, poolIndex: number, child: number): PoolSecrets {
  if (ctx.poolSecrets) return ctx.poolSecrets(poolIndex, child);
  if (!ctx.keys) throw new ExitError("Soapay exit: keys or poolSecrets required");
  return derivePoolSecrets(ctx.keys, poolIndex, child);
}
const maxFeeFor = (ctx: ExitContext, chainId: number) => ctx.maxFeeUsdc?.[chainId] ?? (chainId === ctx.config.source ? 1_000_000n : 5_000_000n);

async function getJson<T>(ctx: ExitContext, url: string, init?: Parameters<ExitFetch>[1]): Promise<T | undefined> {
  const res = await fetcher(ctx)(url, init);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new ExitError(`Soapay exit: ${init?.method ?? "GET"} ${url} → ${res.status} ${await res.text().catch(() => "")}`);
  return (await res.json()) as T;
}

const jsonBody = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

// ---------------------------------------------------------------------------------------------
// Chain helpers
// ---------------------------------------------------------------------------------------------

async function usdcBalance(client: SpendClient, token: Address, who: Address): Promise<bigint> {
  return client.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });
}

async function entryPointNonce(client: SpendClient, sender: Address): Promise<bigint> {
  return client.publicClient.readContract({ address: ENTRYPOINT_V08, abi: entryPointNonceAbi, functionName: "getNonce", args: [sender, 0n] });
}

async function fromBlock(ctx: ExitContext, client: SpendClient): Promise<bigint> {
  const head = await client.publicClient.getBlockNumber();
  const back = ctx.logLookbackBlocks ?? 5000n;
  return head > back ? head - back : 0n;
}

/** Finds the executed userOp (sender, nonce) and returns its tx hash and success. */
async function findUserOp(ctx: ExitContext, client: SpendClient, sender: Address, nonce: bigint) {
  const logs = await client.publicClient.getLogs({
    address: ENTRYPOINT_V08,
    event: entryPointNonceAbi[1],
    args: { sender },
    fromBlock: await fromBlock(ctx, client),
    toBlock: "latest",
  });
  const hit = logs.find((l) => l.args.nonce === nonce);
  return hit ? { txHash: hit.transactionHash as Hash, success: !!hit.args.success } : undefined;
}

/**
 * Resolve a `pending` userOp after a crash. Returns the tx hash if it executed successfully,
 * "retry" if it never executed (or reverted inside), and throws if it executed but the log is not
 * found yet (try again later; do NOT resend).
 */
async function resolvePending(ctx: ExitContext, leg: ExitLeg): Promise<Hash | "retry"> {
  const p = leg.pending!;
  const client = clientFor(ctx, p.chainId);
  const current = await entryPointNonce(client, p.sender);
  if (current <= BigInt(p.nonce)) return "retry";
  const found = await findUserOp(ctx, client, p.sender, BigInt(p.nonce));
  if (!found) throw new ExitError(`Soapay exit: ${p.step} userOp (nonce ${p.nonce}) executed but its log was not found yet`);
  return found.success ? found.txHash : "retry";
}

/** Send one userOp from the leg's stealth address, recording `pending` before it leaves. */
async function sendOnce(
  ctx: ExitContext,
  leg: ExitLeg,
  step: NonNullable<ExitLeg["pending"]>["step"],
  chainId: number,
  calls: StealthCall[],
  feeTokenSpend: bigint,
): Promise<Hash> {
  const client = clientFor(ctx, chainId);
  const execute = ctx.execute ?? executeFromStealth;
  const res = await execute(
    client,
    { stealthKey: ctx.stealthKey, calls, feeTokenSpend, maxFeeUsdc: maxFeeFor(ctx, chainId) },
    {
      onSubmit: async ({ sender, nonce }) => {
        leg.pending = { step, chainId, sender, nonce: nonce.toString() };
        leg.updatedAt = nowOf(ctx);
        await ctx.persist?.(structuredCloneLeg(leg));
      },
    },
  );
  if (!res.txHash) throw new ExitError("Soapay exit: userOp sent without a receipt");
  delete leg.pending;
  return res.txHash;
}

/** Paymaster fee headroom for the re-quote at send time (gas prices move between quotes). */
const withMargin = (fee: bigint) => fee + fee / 10n;

function structuredCloneLeg(leg: ExitLeg): ExitLeg {
  return JSON.parse(JSON.stringify(leg)) as ExitLeg;
}

// ---------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------

export function buildBurnCalls(config: ExitConfig, stealth: Address, amount: bigint, maxFee: bigint): StealthCall[] {
  const { source, dest } = config.cctp;
  return [
    { to: source.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [source.tokenMessenger, amount] }) },
    {
      to: source.tokenMessenger,
      data: encodeFunctionData({
        abi: tokenMessengerV2Abi,
        functionName: "depositForBurnWithHook",
        args: [amount, dest.domain, pad(stealth, { size: 32 }), source.usdc, pad("0x0", { size: 32 }), maxFee, config.cctp.minFinalityThreshold, CCTP_FORWARD_HOOK_DATA],
      }),
    },
  ];
}

export function buildDepositCalls(config: ExitConfig, amount: bigint, precommitment: bigint): StealthCall[] {
  return [
    { to: config.pool.asset, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [config.pool.entrypoint, amount] }) },
    { to: config.pool.entrypoint, data: encodeFunctionData({ abi: ppEntrypointAbi, functionName: "deposit", args: [config.pool.asset, amount, precommitment] }) },
  ];
}

async function fetchCctpFees(ctx: ExitContext): Promise<CctpFeeRow> {
  const { cctp } = ctx.config;
  const rows = await getJson<CctpFeeRow[]>(ctx, `${cctp.irisApiUrl}/v2/burn/USDC/fees/${cctp.source.domain}/${cctp.dest.domain}?forward=true`);
  const row = rows?.find((r) => r.finalityThreshold === cctp.minFinalityThreshold);
  if (!row) throw new ExitError("Soapay exit: no CCTP fee quote");
  return row;
}

async function stepBurn(ctx: ExitContext, leg: ExitLeg): Promise<void> {
  const { config } = ctx;
  if (leg.pending?.step === "burn") {
    const r = await resolvePending(ctx, leg);
    delete leg.pending;
    if (r !== "retry") {
      leg.txs.burn = r;
      leg.status = "burning";
      return;
    }
  }
  const client = clientFor(ctx, config.source);
  const balance = await usdcBalance(client, config.cctp.source.usdc, leg.stealthAddress);
  const cap = maxFeeFor(ctx, config.source);
  const row = await fetchCctpFees(ctx);
  const want = bi(leg.amount);
  // Size the burn so burn + paymaster fee fits the balance (the fee is quoted on a first estimate).
  const guess = want < balance - cap ? want : balance - cap;
  if (guess <= 0n) throw new ExitError(`Soapay exit: ${leg.stealthAddress} holds ${balance} on ${config.source}, not enough to bridge`);
  const estimate = ctx.estimate ?? estimateExecute;
  const est = await estimate(client, {
    stealthKey: ctx.stealthKey,
    calls: buildBurnCalls(config, leg.stealthAddress, guess, cctpMaxFee(guess, row, config.cctp.forwardFeeTier)),
    feeTokenSpend: guess,
    maxFeeUsdc: cap,
  });
  const room = balance - withMargin(est.fee);
  const amount = want < room ? want : room;
  const maxFee = cctpMaxFee(amount, row, config.cctp.forwardFeeTier);
  if (amount <= maxFee) throw new ExitError("Soapay exit: amount does not cover the bridge fee");
  leg.burn = { amount: amount.toString(), maxFee: maxFee.toString() };
  leg.txs.burn = await sendOnce(ctx, leg, "burn", config.source, buildBurnCalls(config, leg.stealthAddress, amount, maxFee), amount);
  leg.status = "burning";
}

type IrisMessage = {
  message?: Hex;
  attestation?: Hex | "PENDING";
  eventNonce?: Hex;
  status?: string;
  forwardState?: string;
  forwardTxHash?: Hash;
  decodedMessage?: { decodedMessageBody?: { amount?: string; feeExecuted?: string } };
};

async function fetchIris(ctx: ExitContext, burnTx: Hash): Promise<IrisMessage | undefined> {
  const { cctp } = ctx.config;
  const r = await getJson<{ messages?: IrisMessage[] }>(ctx, `${cctp.irisApiUrl}/v2/messages/${cctp.source.domain}?transactionHash=${burnTx}`);
  return r?.messages?.[0];
}

async function stepAttestation(ctx: ExitContext, leg: ExitLeg): Promise<void> {
  const m = await fetchIris(ctx, leg.txs.burn!);
  if (!m || m.status !== "complete" || !m.message || !m.attestation || m.attestation === "PENDING" || !m.eventNonce) return;
  leg.cctp = { nonce: m.eventNonce, message: m.message, attestation: m.attestation, ...(m.forwardState ? { forwardState: m.forwardState } : {}) };
  if (m.forwardTxHash) leg.txs.mint = m.forwardTxHash;
  leg.status = "awaiting-mint";
}

async function stepMint(ctx: ExitContext, leg: ExitLeg): Promise<void> {
  const { config } = ctx;
  const client = clientFor(ctx, config.dest);
  const used = await client.publicClient.readContract({
    address: config.cctp.dest.messageTransmitter,
    abi: messageTransmitterV2Abi,
    functionName: "usedNonces",
    args: [leg.cctp!.nonce],
  });
  if (used === 0n) {
    const m = await fetchIris(ctx, leg.txs.burn!);
    if (m?.forwardState) leg.cctp!.forwardState = m.forwardState;
    if (m?.forwardState?.toUpperCase() === "FAILED" && ctx.mintFallback) {
      const tx = await ctx.mintFallback({ message: leg.cctp!.message, attestation: leg.cctp!.attestation, dest: config.dest });
      if (tx) leg.txs.mint = tx;
    }
    return;
  }
  if (!leg.txs.mint) {
    const m = await fetchIris(ctx, leg.txs.burn!).catch(() => undefined);
    if (m?.forwardTxHash) leg.txs.mint = m.forwardTxHash;
  }
  if (!leg.txs.mint) {
    const logs = await client.publicClient
      .getLogs({
        address: config.cctp.dest.messageTransmitter,
        event: messageTransmitterV2Abi[2],
        args: { nonce: leg.cctp!.nonce },
        fromBlock: await fromBlock(ctx, client),
        toBlock: "latest",
      })
      .catch(() => []);
    if (logs[0]) leg.txs.mint = logs[0].transactionHash as Hash;
  }
  leg.mint = { amount: (await usdcBalance(client, config.cctp.dest.usdc, leg.stealthAddress)).toString() };
  leg.status = "minted";
}

async function precommitmentOf(ctx: ExitContext, leg: ExitLeg): Promise<bigint> {
  const pp = await loadPrivacyPoolsSdk();
  const s = secretsFor(ctx, leg.poolIndex, 0);
  return pp.hashPrecommitment(s.nullifier as never, s.secret as never) as bigint;
}

async function stepDeposit(ctx: ExitContext, leg: ExitLeg): Promise<void> {
  const { config } = ctx;
  if (leg.pending?.step === "deposit") {
    const r = await resolvePending(ctx, leg);
    delete leg.pending;
    if (r !== "retry") {
      leg.txs.deposit = r;
      leg.status = "depositing";
      return;
    }
  }
  const client = clientFor(ctx, config.dest);
  const balance = await usdcBalance(client, config.pool.asset, leg.stealthAddress);
  const cap = maxFeeFor(ctx, config.dest);
  const precommitment = await precommitmentOf(ctx, leg);
  const usable = balance - config.ragequitReserve;
  const guess = usable - cap;
  const need = (m: bigint) => `Soapay exit: ${leg.stealthAddress} needs ${m} more USDC on chain ${config.dest} to meet the pool minimum ${config.pool.minDeposit}`;
  if (guess < config.pool.minDeposit) {
    // Check the real fee before giving up: the cap is only an upper bound.
    if (usable <= config.pool.minDeposit) throw new ExitError(need(config.pool.minDeposit - usable + 1n));
  }
  const estimate = ctx.estimate ?? estimateExecute;
  const probe = guess > 0n ? guess : config.pool.minDeposit;
  const est = await estimate(client, {
    stealthKey: ctx.stealthKey,
    calls: buildDepositCalls(config, probe, precommitment),
    feeTokenSpend: 0n,
    maxFeeUsdc: cap,
  });
  const amount = usable - withMargin(est.fee);
  if (amount < config.pool.minDeposit) throw new ExitError(need(config.pool.minDeposit - amount));
  leg.txs.deposit = await sendOnce(ctx, leg, "deposit", config.dest, buildDepositCalls(config, amount, precommitment), amount);
  leg.deposit = { amount: amount.toString(), label: "", value: "", commitment: "", precommitment: precommitment.toString() };
  leg.status = "depositing";
}

async function stepConfirmDeposit(ctx: ExitContext, leg: ExitLeg): Promise<void> {
  const { config } = ctx;
  const client = clientFor(ctx, config.dest);
  const receipt = await client.publicClient.getTransactionReceipt({ hash: leg.txs.deposit! });
  if (receipt.status !== "success") throw new ExitFatalError(`Soapay exit: deposit tx ${leg.txs.deposit} reverted`);
  for (const l of receipt.logs) {
    if (!isAddressEqual(l.address, config.pool.pool)) continue;
    try {
      const ev = decodeEventLog({ abi: ppPoolAbi, data: l.data, topics: l.topics });
      if (ev.eventName !== "Deposited" || !isAddressEqual(ev.args._depositor, leg.stealthAddress)) continue;
      leg.deposit = {
        amount: leg.deposit?.amount ?? ev.args._value.toString(),
        precommitment: ev.args._precommitmentHash.toString(),
        label: ev.args._label.toString(),
        value: ev.args._value.toString(),
        commitment: ev.args._commitment.toString(),
      };
      leg.remaining = ev.args._value.toString();
      leg.status = "pending-asp";
      return;
    } catch {
      /* other pool event */
    }
  }
  throw new ExitFatalError(`Soapay exit: no Deposited event for ${leg.stealthAddress} in ${leg.txs.deposit}`);
}

export type AspStatus = "pending" | "approved" | "declined";

type MtLeaves = { aspLeaves: string[]; stateTreeLeaves: string[] };
async function fetchLeaves(ctx: ExitContext): Promise<MtLeaves> {
  const { config } = ctx;
  const r = await getJson<MtLeaves>(ctx, `${config.aspApiUrl}/${config.dest}/public/mt-leaves`, { headers: { "X-Pool-Scope": config.pool.scope.toString() } });
  if (!r || !Array.isArray(r.aspLeaves) || !Array.isArray(r.stateTreeLeaves)) throw new ExitError("Soapay exit: bad ASP leaves response");
  return r;
}

/** ASP review status for a deposit label: approved once the label is an ASP leaf, declined per the review API. */
export async function checkAspStatus(ctx: Pick<ExitContext, "config" | "fetch">, label: bigint): Promise<AspStatus> {
  const c = ctx as ExitContext;
  const leaves = await fetchLeaves(c);
  if (leaves.aspLeaves.some((x) => BigInt(x) === label)) return "approved";
  const rows = await getJson<{ reviewStatus?: string }[]>(c, `${c.config.aspApiUrl}/${c.config.dest}/public/deposits-by-label`, {
    headers: { "X-Pool-Scope": c.config.pool.scope.toString(), "X-Labels": label.toString() },
  });
  const status = rows?.[0]?.reviewStatus?.toLowerCase();
  if (status === "declined" || status === "rejected") return "declined";
  return "pending";
}

async function stepAsp(ctx: ExitContext, leg: ExitLeg): Promise<void> {
  const status = await checkAspStatus(ctx, bi(leg.deposit!.label));
  leg.asp = { status, checkedAt: nowOf(ctx) };
  if (status === "approved") {
    leg.status = "approved";
    const value = bi(leg.remaining ?? leg.deposit!.value);
    leg.withdrawPlan = planRoundWithdrawals(value, {
      unit: ctx.config.withdrawUnit,
      ...(ctx.withdrawParts !== undefined ? { parts: ctx.withdrawParts } : {}),
      ...(ctx.leaveChange !== undefined ? { leaveChange: ctx.leaveChange } : {}),
      min: 100n,
    }).map(String);
    leg.notBefore = nowOf(ctx) + suggestedDelayMs(ctx.config, ctx.random);
  } else if (status === "declined") {
    leg.status = "declined";
  }
}

type RelayerDetails = { feeBPS: string; feeReceiverAddress: Address; minWithdrawAmount: string };
type RelayerQuote = { feeBPS: string; feeCommitment?: { expiration: number; withdrawalData: Hex; signedRelayerCommitment: Hex; extraGas?: boolean } };

export type WithdrawResult = { leg: ExitLeg; amount: bigint; relayFeeBps: bigint; txHash: Hash; suggestedDelayMs: number };

/**
 * One withdrawal through the 0xbow relayer to `leg.destination` (the relayer pays gas and keeps
 * `feeBPS` of `amount`). `amount` defaults to the next planned round part. Spending the same
 * commitment twice is impossible (the nullifier), so a retried relay can't double-withdraw.
 */
export async function withdrawToDestination(ctx: ExitContext, leg: ExitLeg, opts: { amount?: bigint } = {}): Promise<WithdrawResult> {
  const { config } = ctx;
  if (leg.status !== "approved") throw new ExitError(`Soapay exit: leg is ${leg.status}, not approved`);
  const next = structuredCloneLeg(leg);
  const remaining = bi(next.remaining ?? next.deposit!.value);
  const amount = opts.amount ?? bi(next.withdrawPlan?.[next.withdrawals.filter((w) => w.done).length] ?? remaining.toString());
  if (amount <= 0n || amount > remaining) throw new ExitError(`Soapay exit: withdrawal ${amount} exceeds the ${remaining} left`);
  const pp = await loadPrivacyPoolsSdk();

  const details = await getJson<RelayerDetails>(ctx, `${config.relayerUrl}/relayer/details?chainId=${config.dest}&assetAddress=${config.pool.asset}`);
  if (!details) throw new ExitError("Soapay exit: relayer details unavailable");
  if (amount < BigInt(details.minWithdrawAmount)) throw new ExitError(`Soapay exit: relayer minimum is ${details.minWithdrawAmount}`);
  const quote = await getJson<RelayerQuote>(ctx, `${config.relayerUrl}/relayer/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: jsonBody({ chainId: config.dest, amount: amount.toString(), asset: config.pool.asset, recipient: next.destination, extraGas: false }),
  });
  if (!quote?.feeCommitment) throw new ExitError("Soapay exit: relayer quote without a fee commitment");
  const [recipient, feeRecipient, relayFeeBps] = decodeAbiParameters(
    parseAbiParameters("address recipient, address feeRecipient, uint256 relayFeeBPS"),
    quote.feeCommitment.withdrawalData,
  );
  if (!isAddressEqual(recipient, next.destination)) throw new ExitFatalError("Soapay exit: relayer committed to a different recipient");
  if (relayFeeBps !== BigInt(quote.feeBPS)) throw new ExitError("Soapay exit: relayer fee commitment mismatch");
  if (relayFeeBps > 500n) throw new ExitError(`Soapay exit: relayer fee ${relayFeeBps} bps is too high`);
  void feeRecipient;
  const withdrawal = { processooor: getAddress(config.pool.entrypoint), data: quote.feeCommitment.withdrawalData };

  // The commitment being spent: the deposit (child 0) or the change of the last withdrawal.
  const child = next.withdrawals.filter((w) => w.done).length;
  const label = bi(next.deposit!.label);
  const cur = secretsFor(ctx, next.poolIndex, child);
  const commitment = pp.getCommitment(remaining, label, cur.nullifier as never, cur.secret as never);
  const fresh = secretsFor(ctx, next.poolIndex, child + 1);

  const leaves = await fetchLeaves(ctx);
  const aspLeaves = [...new Set(leaves.aspLeaves)].map((x) => BigInt(x));
  const stateLeaves = leaves.stateTreeLeaves.map((x) => BigInt(x));
  let stateProof, aspProof;
  try {
    stateProof = pp.generateMerkleProof(stateLeaves, commitment.hash);
    aspProof = pp.generateMerkleProof(aspLeaves, label);
  } catch {
    throw new ExitError("Soapay exit: commitment or label not in the ASP snapshot yet");
  }
  if (Number.isNaN(aspProof.index)) aspProof.index = 0; // SDK quirk the 0xbow website also patches
  const onchainRoot = await clientFor(ctx, config.dest).publicClient.readContract({ address: config.pool.entrypoint, abi: ppEntrypointAbi, functionName: "latestRoot" });
  if (onchainRoot !== aspProof.root) throw new ExitError("Soapay exit: ASP root not on-chain yet");
  const padTo = (a: bigint[]) => [...a, ...Array(Math.max(0, 32 - a.length)).fill(0n)] as bigint[];
  const context = BigInt(pp.calculateContext(withdrawal, config.pool.scope as never));
  const input: WithdrawalProofInputs = {
    withdrawalAmount: amount,
    stateMerkleProof: { root: stateProof.root, leaf: commitment.hash, index: stateProof.index, siblings: padTo(stateProof.siblings) },
    aspMerkleProof: { root: aspProof.root, leaf: label, index: aspProof.index, siblings: padTo(aspProof.siblings) },
    stateRoot: stateProof.root,
    stateTreeDepth: 32n,
    aspRoot: aspProof.root,
    aspTreeDepth: 32n,
    context,
    newSecret: fresh.secret,
    newNullifier: fresh.nullifier,
  };
  const prover = ctx.prover ?? privacyPoolsProver(config.circuitsBaseUrl);
  const proof = await prover.proveWithdrawal({ value: remaining, label, nullifier: cur.nullifier, secret: cur.secret, hash: commitment.hash }, input);

  const res = await getJson<{ success: boolean; txHash?: Hash; error?: string }>(ctx, `${config.relayerUrl}/relayer/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: jsonBody({ withdrawal, proof: proof.proof, publicSignals: proof.publicSignals, scope: config.pool.scope.toString(), chainId: config.dest, feeCommitment: quote.feeCommitment }),
  });
  if (!res?.success || !res.txHash) throw new ExitError(`Soapay exit: relay failed: ${res?.error ?? "no tx hash"}`);
  next.withdrawals.push({ amount: amount.toString(), child, tx: res.txHash });
  next.txs.withdraw = res.txHash;
  next.status = "withdrawing";
  next.updatedAt = nowOf(ctx);
  delete next.error;
  return { leg: next, amount, relayFeeBps, txHash: res.txHash, suggestedDelayMs: suggestedDelayMs(config, ctx.random) };
}

async function stepConfirmWithdraw(ctx: ExitContext, leg: ExitLeg): Promise<void> {
  const client = clientFor(ctx, ctx.config.dest);
  const w = leg.withdrawals.at(-1)!;
  const receipt = await client.publicClient.getTransactionReceipt({ hash: w.tx! }).catch(() => undefined);
  if (!receipt) return; // not mined yet
  if (receipt.status !== "success") {
    leg.withdrawals.pop();
    leg.status = "approved";
    leg.error = `withdrawal ${w.tx} reverted; will retry`;
    return;
  }
  w.done = true;
  const remaining = bi(leg.remaining) - bi(w.amount);
  leg.remaining = remaining.toString();
  const planned = leg.withdrawPlan?.length ?? 0;
  const doneCount = leg.withdrawals.filter((x) => x.done).length;
  if (remaining === 0n || doneCount >= planned) {
    leg.status = "done";
  } else {
    leg.status = "approved";
    leg.notBefore = nowOf(ctx) + suggestedDelayMs(ctx.config, ctx.random);
  }
}

async function stepRagequit(ctx: ExitContext, leg: ExitLeg): Promise<void> {
  const { config } = ctx;
  if (leg.pending?.step === "refund") {
    const r = await resolvePending(ctx, leg);
    delete leg.pending;
    if (r !== "retry") {
      leg.txs.refund = r;
      leg.status = "refunded";
      return;
    }
  }
  const s = secretsFor(ctx, leg.poolIndex, 0);
  const prover = ctx.prover ?? privacyPoolsProver(config.circuitsBaseUrl);
  const proof = await prover.proveCommitment(bi(leg.deposit!.value), bi(leg.deposit!.label), s.nullifier, s.secret);
  const f = formatGroth16(proof);
  const data = encodeFunctionData({
    abi: ppPoolAbi,
    functionName: "ragequit",
    args: [{ pA: f.pA, pB: f.pB, pC: f.pC, pubSignals: f.pubSignals.slice(0, 4) as unknown as readonly [bigint, bigint, bigint, bigint] }],
  });
  leg.txs.refund = await sendOnce(ctx, leg, "refund", config.dest, [{ to: config.pool.pool, data }], 0n);
  leg.remaining = "0";
  leg.status = "refunded";
}

// ---------------------------------------------------------------------------------------------
// The step machine
// ---------------------------------------------------------------------------------------------

const inflight = new Map<string, Promise<ExitLeg>>();

/**
 * Advance one leg by at most one transition. Idempotent and resumable:
 * - Waiting states (burning, awaiting-mint, pending-asp, approved before `notBefore`, withdrawing)
 *   only poll; calling again before anything changed returns the same state.
 * - Send states record `pending` (via `ctx.persist`) before the userOp leaves; on resume the
 *   EntryPoint nonce tells whether it executed, so a crash never double-sends.
 * - Concurrent calls for the same leg id share one in-flight promise.
 * Retryable failures keep the status and set `error`; `ExitFatalError` moves the leg to `failed`.
 */
export function advanceExitLeg(ctx: ExitContext, leg: ExitLeg): Promise<ExitLeg> {
  const running = inflight.get(leg.id);
  if (running) return running;
  const p = advance(ctx, leg).finally(() => inflight.delete(leg.id));
  inflight.set(leg.id, p);
  return p;
}

async function advance(ctx: ExitContext, input: ExitLeg): Promise<ExitLeg> {
  const leg = structuredCloneLeg(input);
  if (leg.source !== ctx.config.source || leg.dest !== ctx.config.dest) throw new ExitError("Soapay exit: leg route does not match config");
  if (getSpendChainConfig(ctx.config.dest).usdc.toLowerCase() !== ctx.config.pool.asset.toLowerCase())
    throw new ExitError("Soapay exit: pool asset is not the destination USDC");
  const before = JSON.stringify(input);
  try {
    delete leg.error;
    switch (leg.status) {
      case "planned":
        await stepBurn(ctx, leg);
        break;
      case "burning":
        await stepAttestation(ctx, leg);
        break;
      case "awaiting-mint":
        await stepMint(ctx, leg);
        break;
      case "minted":
        await stepDeposit(ctx, leg);
        break;
      case "depositing":
        await stepConfirmDeposit(ctx, leg);
        break;
      case "pending-asp":
        await stepAsp(ctx, leg);
        break;
      case "approved": {
        if (leg.notBefore !== undefined && nowOf(ctx) < leg.notBefore) return input;
        const r = await withdrawToDestination(ctx, leg);
        Object.assign(leg, r.leg);
        break;
      }
      case "withdrawing":
        await stepConfirmWithdraw(ctx, leg);
        break;
      case "declined":
        await stepRagequit(ctx, leg);
        break;
      case "done":
      case "refunded":
      case "failed":
        return input;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof ExitFatalError) leg.status = "failed";
    leg.error = message;
  }
  if (JSON.stringify(leg) === before) return input;
  leg.updatedAt = nowOf(ctx);
  return leg;
}

/** True when the leg needs no more calls. */
export function isExitLegFinal(leg: ExitLeg): boolean {
  return leg.status === "done" || leg.status === "refunded" || leg.status === "failed";
}
