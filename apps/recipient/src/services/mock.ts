/**
 * In-browser mock of the Soapay API, the chain reads the app needs, and the bundler. Enabled with
 * VITE_MOCK_API=1 for demos and UI work without a running API, RPC or bundler.
 *
 * Payments are derived with the real SDK (`derivePayRun`) for the unlocked meta-address, so the real
 * scanner, ledger and guard run unchanged: only this user's lines match, among a few thousand
 * announcements for other people. Ephemeral keys for the user's own lines are deterministic
 * (seeded by the meta-address), so a reload yields the same payments.
 */
import {
  SpendManyError,
  buildMetadata77,
  derivePayRun,
  getChainConfig,
  isValidLabel,
  splitIntoDenominations,
  type PayRunLine,
} from "@soapay/sdk";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import type { ApiFetch } from "../api/client.js";
import type { SendProgress, SpendQuote, SpendService } from "./spend.js";
import type { SpendParams, SpendResult, SwapQuote } from "@soapay/sdk";
import type { EnsWriter } from "../features/rotation/ens.js";
import { NATIVE_ETH, type SwapService } from "../features/convert/swap.js";
import { privateKeyToAccount } from "viem/accounts";

export const MOCK_EMPLOYER: Address = "0x5ca1ab1e00000000000000000000000000000e3e";
export const MOCK_DISPERSE: Address = "0xd15fe25e00000000000000000000000000000d15";
const MOCK_SPAMMER: Address = "0xbad0000000000000000000000000000000000bad";
const USDC_UNIT = 1_000_000n;
const NOISE_ANNOUNCEMENTS = 3_000;

type MockAnn = {
  blockNumber: bigint;
  txHash: Hex;
  logIndex: number;
  stealthAddress: Address;
  caller: Address;
  ephemeralPubKey: Hex;
  metadata: Hex;
};

type World = { chainId: number; startBlock: bigint; anns: MockAnn[]; balances: Map<string, bigint> };

const state: {
  meta: string | null;
  world: World | null;
  names: Map<string, { label: string; registrant: Address; metaAddress: string; deadline: string }>;
  rotations: { label: string; oldMeta: string; newMeta: string; verifiedAt: string }[];
  /** label → World ID session id (mock of the API's session binding). */
  sessions: Map<string, string>;
  registered: Set<string>;
  bornAt: number;
} = { meta: null, world: null, names: new Map(), rotations: [], sessions: new Map(), registered: new Set(), bornAt: Date.now() };

/**
 * Demo trigger for the partial-failure path: sending to an address that starts with this prefix makes
 * the SECOND userOp of the run fail (SpendManyError), so the first one lands and the rest don't.
 */
export const MOCK_FAIL_PREFIX = "0xfa11";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const latency = () => sleep(120 + Math.random() * 250);

/** Tell the mock whose payments to fabricate. Called when the vault unlocks in mock mode. */
export function setMockIdentity(metaAddressURI: string): void {
  if (state.meta === metaAddressURI) return;
  state.meta = metaAddressURI;
  state.world = null;
}

function deterministicKeys(seed: string): () => Uint8Array {
  let i = 0;
  return () => {
    for (;;) {
      const k = keccak_256(new TextEncoder().encode(`${seed}:${i++}`));
      if (secp256k1.utils.isValidSecretKey(k)) return k;
    }
  };
}

function fakeTxHash(seed: string): Hex {
  return keccak256(toHex(seed));
}

function noiseAnnouncement(block: bigint, logIndex: number, txHash: Hex): MockAnn {
  const eph = secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), true);
  const stealth = getAddress(bytesToHex(secp256k1.utils.randomSecretKey().slice(0, 20)));
  const amount = BigInt(200 + Math.floor(Math.random() * 800)) * USDC_UNIT;
  return {
    blockNumber: block,
    txHash,
    logIndex,
    stealthAddress: stealth,
    caller: MOCK_DISPERSE,
    ephemeralPubKey: bytesToHex(eph),
    metadata: buildMetadata77({ viewTag: Math.floor(Math.random() * 256), token: getAddress("0x" + "11".repeat(20)), amount, payer: MOCK_EMPLOYER }),
  };
}

function buildWorld(meta: string, chainId: number): World {
  const cfg = getChainConfig(chainId);
  const usdc = cfg.usdc;
  const start = cfg.announcerStartBlock + 1_000n;
  const anns: MockAnn[] = [];
  const balances = new Map<string, bigint>();
  const keyFor = deterministicKeys(meta);

  const addRun = (block: bigint, runSeed: string, salary: bigint, payer: Address, caller: Address, lie?: bigint) => {
    const lines: PayRunLine[] = derivePayRun({
      recipients: [{ metaAddressURI: meta, amount: salary, id: "me" }],
      denominate: (a) => splitIntoDenominations(a, 500n * USDC_UNIT).chunks,
      randomEphemeralKey: keyFor,
    });
    const txHash = fakeTxHash(runSeed);
    let logIndex = 0;
    // Other employees' lines in the same batch (unrelated keys, never match).
    const mine = lines.map((l) => ({ l, noise: false }));
    const others = Array.from({ length: 40 }, () => ({ l: null, noise: true }));
    const mixed = [...mine, ...others].sort(() => Math.random() - 0.5);
    for (const row of mixed) {
      if (row.noise || !row.l) {
        anns.push(noiseAnnouncement(block, logIndex++, txHash));
        continue;
      }
      const l = row.l;
      anns.push({
        blockNumber: block,
        txHash,
        logIndex: logIndex++,
        stealthAddress: l.stealthAddress,
        caller,
        ephemeralPubKey: l.ephemeralPublicKey,
        metadata: buildMetadata77({ viewTag: l.viewTag, token: usdc, amount: lie ?? l.amount, payer }),
      });
      balances.set(l.stealthAddress.toLowerCase(), l.amount);
    }
  };

  addRun(start + 100n, `${meta}:run1`, 2_600n * USDC_UNIT, MOCK_EMPLOYER, MOCK_DISPERSE);
  addRun(start + 2_100n, `${meta}:run2`, 2_600n * USDC_UNIT, MOCK_EMPLOYER, MOCK_DISPERSE);
  addRun(start + 4_100n, `${meta}:run3`, 2_750n * USDC_UNIT, MOCK_EMPLOYER, MOCK_DISPERSE);
  // A stranger announces straight to the Announcer and claims to be the employer, with a fake amount.
  // The ledger must flag it (unknown payer, amount mismatch) and use the real 1 USDC balance.
  const spamLines = derivePayRun({ recipients: [{ metaAddressURI: meta, amount: USDC_UNIT, id: "me" }], randomEphemeralKey: keyFor });
  for (const l of spamLines) {
    anns.push({
      blockNumber: start + 3_000n,
      txHash: fakeTxHash(`${meta}:spam`),
      logIndex: 0,
      stealthAddress: l.stealthAddress,
      caller: MOCK_SPAMMER,
      ephemeralPubKey: l.ephemeralPublicKey,
      metadata: buildMetadata77({ viewTag: l.viewTag, token: usdc, amount: 10_000n * USDC_UNIT, payer: MOCK_EMPLOYER }),
    });
    balances.set(l.stealthAddress.toLowerCase(), USDC_UNIT);
  }
  // Background traffic from other Soapay users and other apps.
  for (let i = 0; i < NOISE_ANNOUNCEMENTS; i++) {
    const block = start + BigInt(Math.floor(Math.random() * 5_000));
    anns.push(noiseAnnouncement(block, 500 + (i % 50), fakeTxHash(`noise:${i}`)));
  }
  anns.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  return { chainId, startBlock: start, anns, balances };
}

function world(chainId: number): World {
  if (!state.meta) throw new Error("mock: no identity yet");
  if (!state.world || state.world.chainId !== chainId) state.world = buildWorld(state.meta, chainId);
  return state.world;
}

function head(chainId: number): bigint {
  const w = world(chainId);
  // The chain keeps moving: one block every 2 s since the mock started.
  return w.startBlock + 5_000n + BigInt(Math.floor((Date.now() - state.bornAt) / 2_000));
}

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const err = (status: number, code: string, message: string) => respond(status, { error: { code, message } });

export function createMockFetch(chainId: number): ApiFetch {
  return async (input, init) => {
    await latency();
    const url = new URL(input, "http://mock.local");
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^.*?(\/(announcements|register|names|health))/, "$1");

    const attach = /^\/names\/([^/]+)\/session$/.exec(path);
    if (method === "POST" && attach) {
      const label = decodeURIComponent(attach[1]!);
      if (!state.names.has(label)) return err(404, "not_found", "name not found");
      const body = JSON.parse(String(init?.body ?? "{}")) as { signature?: string; deadline?: string; worldIdResult?: { session_id?: string } };
      if (!body.signature || !body.deadline) return err(400, "invalid_body", "deadline and signature are required");
      const sessionId = body.worldIdResult?.session_id;
      if (!sessionId || !/^session_[0-9a-f]+$/i.test(sessionId)) return err(403, "proof_missing", "worldIdResult must be an IDKit session result");
      if (state.sessions.has(label)) return err(409, "session_exists", "this name already has a World ID session");
      const attachedAt = Math.floor(Date.now() / 1000);
      state.sessions.set(label, sessionId);
      return respond(201, { label, sessionId, attachedAt, rotationAllowedFrom: attachedAt + 72 * 3600 });
    }

    const rotation = /^\/names\/([^/]+)\/rotation$/.exec(path);
    if (method === "POST" && rotation) {
      const label = decodeURIComponent(rotation[1]!);
      const row = state.names.get(label);
      if (!row) return err(404, "not_found", "name not found");
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        newMeta?: string;
        deadline?: string;
        registrantSig?: string;
        registerSig?: string;
        worldIdResult?: { session_id?: string };
      };
      if (!body.newMeta || !body.deadline || !body.registrantSig || !body.registerSig) {
        return err(400, "invalid_body", "newMeta, deadline, registrantSig and registerSig are required");
      }
      const bound = state.sessions.get(label);
      if (!bound) return err(403, "no_session", "this name has no World ID session; the employer must approve changes");
      if (body.worldIdResult?.session_id !== bound) return err(403, "session_mismatch", "not the session enrolled for this name");
      if (BigInt(body.deadline) <= BigInt(Math.floor(Date.now() / 1000))) return err(400, "expired", "deadline has passed");
      const oldMeta = row.metaAddress.toLowerCase();
      const newMeta = body.newMeta.toLowerCase();
      if (oldMeta === newMeta) return err(409, "no_change", "newMeta equals the current meta-address");
      const verifiedAt = String(Math.floor(Date.now() / 1000));
      state.names.set(label, { ...row, metaAddress: newMeta });
      state.rotations.push({ label, oldMeta, newMeta, verifiedAt });
      return respond(201, {
        attester: MOCK_EMPLOYER,
        attestation: { label, oldMeta, newMeta, verifiedAt, signature: fakeTxHash(`attest:${label}:${verifiedAt}`) + "00" },
        registry: { status: "success", txHash: fakeTxHash(`reregister:${label}:${verifiedAt}`) },
        topup: { status: "sent", txHash: fakeTxHash(`fund:${label}:${verifiedAt}`) },
      });
    }

    if (method === "GET" && path === "/health") return respond(200, { ok: true, chainId, mock: true });

    if (method === "GET" && path === "/announcements") {
      if (!state.meta) return respond(200, { items: [], nextCursor: null });
      const w = world(chainId);
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const limit = Number(url.searchParams.get("limit") ?? 1000);
      const cursor = Number(url.searchParams.get("cursor") ?? 0);
      const rows = w.anns.filter(
        (a) => (from === null || a.blockNumber >= BigInt(from)) && (to === null || a.blockNumber <= BigInt(to)),
      );
      const page = rows.slice(cursor, cursor + limit);
      return respond(200, {
        items: page.map((a) => ({ ...a, blockNumber: a.blockNumber.toString() })),
        nextCursor: cursor + limit < rows.length ? String(cursor + limit) : null,
      });
    }

    if (method === "POST" && path === "/register") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { registrant?: string; metaAddress?: string };
      if (!body.registrant || !body.metaAddress) return err(400, "invalid_body", "registrant and metaAddress are required");
      state.registered.add(body.registrant.toLowerCase());
      return respond(200, { txHash: fakeTxHash(`register:${body.registrant}`), status: "success" });
    }

    const nameMatch = /^\/names(?:\/([^/]+))?$/.exec(path);
    if (nameMatch) {
      if (method === "GET" && nameMatch[1]) {
        const label = decodeURIComponent(nameMatch[1]);
        if (!isValidLabel(label)) return err(400, "invalid_label", "invalid label");
        if (["alice", "bob", "carol", "admin", "payroll"].includes(label)) {
          return respond(200, present({ label, registrant: MOCK_SPAMMER, metaAddress: "st:eth:0x", deadline: "0" }));
        }
        const row = state.names.get(label);
        return row ? respond(200, present(row)) : err(404, "not_found", "name not found");
      }
      if (method === "POST" && !nameMatch[1]) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          label: string;
          registrant: Address;
          metaAddress: string;
          deadline: string;
          worldIdSession?: { session_id?: string };
        };
        if (!isValidLabel(body.label)) return err(400, "invalid_label", "label must be 3-32 of [a-z0-9-]");
        if (!state.registered.has(body.registrant.toLowerCase())) {
          return err(409, "meta_mismatch", "metaAddress does not match stealthMetaAddressOf(registrant, 1) on-chain");
        }
        const existing = state.names.get(body.label);
        if (existing && existing.registrant.toLowerCase() !== body.registrant.toLowerCase()) {
          return err(409, "label_taken", "label is already taken");
        }
        const row = { label: body.label, registrant: body.registrant, metaAddress: body.metaAddress, deadline: body.deadline };
        state.names.set(body.label, row);
        if (body.worldIdSession?.session_id) state.sessions.set(body.label, body.worldIdSession.session_id);
        return respond(201, present(row));
      }
    }
    return err(404, "not_found", "Route not found");
  };
}

function present(row: { label: string; registrant: Address; metaAddress: string; deadline: string }) {
  const now = new Date().toISOString();
  return { ...row, name: `${row.label}.soapay.eth`, txHash: null, createdAt: now, updatedAt: now };
}

/** Just enough of a viem PublicClient for the scanner, ledger and registration. */
export function createMockPublicClient(chainId: number) {
  const cfg = getChainConfig(chainId);
  return {
    chain: cfg.chain,
    async getBlockNumber() {
      await latency();
      return head(chainId);
    },
    async readContract() {
      await latency();
      return 0n; // nonceOf(registrant): fresh registrant
    },
    async getLogs(args: { fromBlock: bigint; toBlock: bigint }) {
      await latency();
      if (!state.meta) return [];
      return world(chainId)
        .anns.filter((a) => a.blockNumber >= args.fromBlock && a.blockNumber <= args.toBlock)
        .map((a) => ({
          blockNumber: a.blockNumber,
          transactionHash: a.txHash,
          logIndex: a.logIndex,
          args: {
            schemeId: 1n,
            stealthAddress: a.stealthAddress,
            caller: a.caller,
            ephemeralPubKey: a.ephemeralPubKey,
            metadata: a.metadata,
          },
        }));
    },
    async multicall(args: { contracts: { address: Address; args: readonly [Address] }[] }) {
      await latency();
      const w = state.world;
      return args.contracts.map((c) => {
        const isUsdc = c.address.toLowerCase() === cfg.usdc.toLowerCase();
        const bal = isUsdc ? (w?.balances.get(c.args[0].toLowerCase()) ?? 0n) : 0n;
        return { status: "success" as const, result: bal };
      });
    },
  };
}

const MOCK_FEE = 21_450n; // ~0.02 USDC, typical for a first 7702 spend on Base

export function createMockSpendService(): SpendService {
  const delegated = new Set<string>();
  const balanceOf = (a: string) => state.world?.balances.get(a.toLowerCase()) ?? 0n;
  return {
    ready: true,
    async quote(stealthKey, _to): Promise<SpendQuote> {
      await latency();
      const from = privateKeyToAccount(stealthKey).address;
      const balance = balanceOf(from);
      const fee = delegated.has(from.toLowerCase()) ? MOCK_FEE - 6_000n : MOCK_FEE;
      return { from, fee, balance, maxSendable: balance > fee ? balance - fee : 0n, delegated: delegated.has(from.toLowerCase()) };
    },
    async sendAll(spends: readonly SpendParams[], onProgress?: SendProgress): Promise<SpendResult[]> {
      const out: SpendResult[] = [];
      onProgress?.(0, spends.length);
      for (const [i, s] of spends.entries()) {
        if (i > 0) await sleep(600 + Math.random() * 900); // real sends wait 4-24 s
        const from = privateKeyToAccount(s.stealthKey).address;
        const bal = balanceOf(from);
        const amount = s.amount === "max" ? bal - MOCK_FEE : s.amount;
        // Same contract as the SDK's spendMany: stop at the first failure, report what already landed.
        if (i === 1 && s.to.toLowerCase().startsWith(MOCK_FAIL_PREFIX)) {
          throw new SpendManyError(out, i, new Error("mock: bundler rejected the userOp (AA21 didn't pay prefund)"));
        }
        if (amount + MOCK_FEE > bal) throw new SpendManyError(out, i, new Error(`mock: insufficient balance in ${from}`));
        state.world?.balances.set(from.toLowerCase(), bal - amount - MOCK_FEE);
        delegated.add(from.toLowerCase());
        out.push({
          from,
          userOpHash: fakeTxHash(`op:${from}:${Date.now()}`),
          txHash: fakeTxHash(`tx:${from}:${Date.now()}`),
          delegated: true,
          amount,
          feeEstimate: MOCK_FEE,
        });
        onProgress?.(i + 1, spends.length);
      }
      return out;
    },
  };
}

/** Stands in for the ENSv2 `setText(stealth)` on Sepolia. */
export function createMockEnsWriter(): EnsWriter {
  return {
    ready: true,
    async setStealthRecord({ name, metaAddress }) {
      await sleep(900);
      return { txHash: fakeTxHash(`setText:${name}:${metaAddress}`) };
    },
  };
}

/** Rough mock price, USDC base units per whole ETH. */
const MOCK_USDC_PER_ETH = 3_000n * USDC_UNIT;
const MOCK_ROUTER: Address = "0x000000000000000000000000000000000000c0de";

/** Quotes and "executes" swaps in place against the mock balances (USDC in, fee in USDC). */
export function createMockSwapService(chainId: number): SwapService {
  const usdc = getChainConfig(chainId).usdc;
  const quote = async (r: { stealthKey: Hex; tokenOut: Address; amountIn: bigint; slippageBps: number }): Promise<SwapQuote> => {
    await latency();
    const stealthAddress = privateKeyToAccount(r.stealthKey).address;
    const amountOut = (r.amountIn * 10n ** 18n) / MOCK_USDC_PER_ETH;
    return {
      source: "universal-router",
      chainId,
      stealthAddress,
      tokenIn: usdc,
      tokenOut: r.tokenOut,
      amountIn: r.amountIn,
      amountOut,
      minOut: (amountOut * BigInt(10_000 - r.slippageBps)) / 10_000n,
      slippageBps: r.slippageBps,
      route: `USDC -[v3 0.05%]-> ${r.tokenOut === NATIVE_ETH ? "ETH" : "WETH"}`,
      router: MOCK_ROUTER,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
      calls: [],
    };
  };
  return {
    ready: true,
    route: "Mock Uniswap (1 ETH = 3,000 USDC)",
    quote,
    async swap(r) {
      const q = await quote(r);
      await sleep(1_200);
      const from = q.stealthAddress;
      const bal = state.world?.balances.get(from.toLowerCase()) ?? 0n;
      if (r.amountIn + MOCK_FEE > bal) throw new Error("mock: amount plus fee exceeds the USDC balance");
      state.world?.balances.set(from.toLowerCase(), bal - r.amountIn - MOCK_FEE);
      return {
        from,
        userOpHash: fakeTxHash(`swapop:${from}:${Date.now()}`),
        txHash: fakeTxHash(`swaptx:${from}:${Date.now()}`),
        delegated: true,
        feeEstimate: MOCK_FEE,
        quote: q,
      };
    },
  };
}
