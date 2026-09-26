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
  CIRCLE_PAYMASTER_V08,
  circleUsdcFor,
  defaultPaymasterMode,
  ENTRYPOINT_V08,
  SIMPLE_7702_ACCOUNT,
  SpendManyError,
  announcerAbi,
  buildMetadata77,
  compareAddresses,
  erc20Abi,
  userOperationEventAbi,
  derivePayRun,
  getChainConfig,
  isValidLabel,
  splitIntoDenominations,
  worldIdNullifierOf,
  type PayRunLine,
} from "@soapay/sdk";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, encodeAbiParameters, encodeEventTopics, getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import type { ApiFetch } from "../api/client.js";
import type { SendProgress, SpendQuote, SpendService } from "./spend.js";
import type { SpendParams, SpendResult } from "@soapay/sdk";
import type { EnsWriter } from "../features/rotation/ens.js";
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
  /** USDC moved to the stealth address in the same tx (a Transfer log in its receipt), if any. */
  transfer?: { from: Address; amount: bigint };
};

/** A mock gasless spend, so the proof panel's receipt read has something to decode. */
type MockSpendTx = { txHash: Hex; userOpHash: Hex; from: Address; to: Address; amount: bigint; fee: bigint; block: bigint };

type World = { chainId: number; startBlock: bigint; anns: MockAnn[]; balances: Map<string, bigint> };

const state: {
  meta: string | null;
  world: World | null;
  names: Map<string, { label: string; registrant: Address; metaAddress: string; deadline: string }>;
  rotations: { label: string; oldMeta: string; newMeta: string; verifiedAt: string }[];
  /** label → linked World ID nullifier, decimal (mock of the API's World ID link, D-58). */
  sessions: Map<string, string>;
  /** Invite code hashes already used. */
  claimedInvites: Set<string>;
  registered: Set<string>;
  /** Stealth addresses (lowercase) that have a 7702 delegation after their first mock spend or swap. */
  delegated: Set<string>;
  spendTxs: Map<string, MockSpendTx>;
  bornAt: number;
} = {
  meta: null,
  world: null,
  names: new Map(),
  rotations: [],
  sessions: new Map(),
  claimedInvites: new Set(),
  registered: new Set(),
  delegated: new Set(),
  spendTxs: new Map(),
  bornAt: Date.now(),
};

/** Demo invite links (docs/mvp-spec.md §7): open `#/join?code=<code>` in mock mode. */
export const MOCK_INVITES = {
  pending: { code: `0x${"1".repeat(64)}` as Hex, label: "jordan", org: "Acme Robotics" },
  expired: { code: `0x${"2".repeat(64)}` as Hex, label: "sam", org: "Acme Robotics" },
} as const;

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

  // Coworkers in the same payroll batch: salaries split into the same 500 USDC chunks (D-31), with keys
  // nobody here holds, so their lines never match.
  const COWORKER_SALARIES = [2_400n, 3_100n, 1_850n, 2_750n, 4_200n, 2_600n, 3_300n];
  const addRun = (block: bigint, runSeed: string, salary: bigint, payer: Address, caller: Address, lie?: bigint) => {
    const lines: PayRunLine[] = derivePayRun({
      recipients: [{ metaAddressURI: meta, amount: salary, id: "me" }],
      denominate: (a) => splitIntoDenominations(a, 500n * USDC_UNIT).chunks,
      randomEphemeralKey: keyFor,
    });
    const txHash = fakeTxHash(runSeed);
    const rows: Omit<MockAnn, "logIndex">[] = lines.map((l) => {
      balances.set(l.stealthAddress.toLowerCase(), l.amount);
      return {
        blockNumber: block,
        txHash,
        stealthAddress: l.stealthAddress,
        caller,
        ephemeralPubKey: l.ephemeralPublicKey,
        metadata: buildMetadata77({ viewTag: l.viewTag, token: usdc, amount: lie ?? l.amount, payer }),
        transfer: { from: payer, amount: l.amount },
      };
    });
    for (const salary of COWORKER_SALARIES) {
      for (const amount of splitIntoDenominations(salary * USDC_UNIT, 500n * USDC_UNIT).chunks) {
        const eph = secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), true);
        rows.push({
          blockNumber: block,
          txHash,
          stealthAddress: getAddress(bytesToHex(secp256k1.utils.randomSecretKey().slice(0, 20))),
          caller,
          ephemeralPubKey: bytesToHex(eph),
          metadata: buildMetadata77({ viewTag: Math.floor(Math.random() * 256), token: usdc, amount, payer }),
          transfer: { from: payer, amount },
        });
      }
    }
    // StealthDisperse order: strictly ascending by stealth address, whoever the line belongs to.
    rows.sort((a, b) => compareAddresses(a.stealthAddress, b.stealthAddress));
    // Per line the contract logs transferFrom's Transfer, then the Announcement.
    rows.forEach((r, i) => anns.push({ ...r, logIndex: 2 * i + 1 }));
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
      transfer: { from: MOCK_SPAMMER, amount: USDC_UNIT },
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
    const path = url.pathname.replace(/^.*?(\/(announcements|register|names|invites|health))/, "$1");

    const invite = /^\/invites\/(0x[0-9a-fA-F]{64})$/.exec(path);
    if (method === "GET" && invite) {
      const hash = invite[1]!.toLowerCase();
      const now = Math.floor(Date.now() / 1000);
      for (const [kind, inv] of Object.entries(MOCK_INVITES)) {
        if (keccak256(inv.code).toLowerCase() !== hash) continue;
        const claimed = state.claimedInvites.has(hash);
        return respond(200, {
          label: inv.label,
          employer: MOCK_EMPLOYER,
          org: inv.org,
          expiresAt: kind === "expired" ? now - 86_400 : now + 14 * 86_400,
          status: kind === "expired" ? "expired" : claimed ? "claimed" : "pending",
          ...(claimed ? { name: `${inv.label}.soapay.eth` } : {}),
        });
      }
      return err(404, "not_found", "invite not found");
    }

    const attach = /^\/names\/([^/]+)\/session$/.exec(path);
    if (method === "POST" && attach) {
      const label = decodeURIComponent(attach[1]!);
      if (!state.names.has(label)) return err(404, "not_found", "name not found");
      const body = JSON.parse(String(init?.body ?? "{}")) as { signature?: string; deadline?: string; worldIdResult?: unknown };
      if (!body.signature || !body.deadline) return err(400, "invalid_body", "deadline and signature are required");
      const nullifier = worldIdNullifierOf(body.worldIdResult);
      if (nullifier === undefined) return err(403, "proof_missing", "worldIdResult must be an IDKit Proof of Human result");
      if (state.sessions.has(label)) return err(409, "session_exists", "this name is already linked to a World ID");
      const attachedAt = Math.floor(Date.now() / 1000);
      state.sessions.set(label, nullifier.toString());
      return respond(201, { label, attachedAt, rotationAllowedFrom: attachedAt + 72 * 3600 });
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
        worldIdResult?: unknown;
      };
      if (!body.newMeta || !body.deadline || !body.registrantSig || !body.registerSig) {
        return err(400, "invalid_body", "newMeta, deadline, registrantSig and registerSig are required");
      }
      const bound = state.sessions.get(label);
      if (!bound) return err(409, "no_worldid_link", "this name isn't linked to a World ID; the employer must approve changes");
      if (worldIdNullifierOf(body.worldIdResult)?.toString() !== bound) {
        return err(403, "human_mismatch", "proof is from a different person than the one linked to this name");
      }
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
        // The indexer serves announcements only; the Transfer side lives in receipts.
        items: page.map(({ transfer: _t, ...a }) => ({ ...a, blockNumber: a.blockNumber.toString() })),
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
          worldIdSession?: unknown;
          inviteCode?: Hex;
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
        const reserved = Object.values(MOCK_INVITES).find((i) => i.label === body.label);
        if (reserved && !state.claimedInvites.has(keccak256(reserved.code).toLowerCase())) {
          if (!body.inviteCode || keccak256(body.inviteCode).toLowerCase() !== keccak256(reserved.code).toLowerCase()) {
            return err(409, "label_reserved", "this label is reserved by an invite");
          }
          state.claimedInvites.add(keccak256(reserved.code).toLowerCase());
        }
        state.names.set(body.label, row);
        const linked = worldIdNullifierOf(body.worldIdSession);
        if (linked !== undefined) state.sessions.set(body.label, linked.toString());
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

const ANNOUNCER: Address = "0x55649E01B5Df198D18D95b5cc5051630cfD45564";
/** Stands in for the bundler that submits mock userOps (and fronts their ETH gas). */
const MOCK_BUNDLER: Address = "0x4337012eaf1f862b8dbdc6b62a01782ae01ef038";

function transferLog(token: Address, from: Address, to: Address, amount: bigint, logIndex: number) {
  return {
    address: getAddress(token),
    topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from, to } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
    logIndex,
  };
}

/** A stand-in sponsorship paymaster (Base Sepolia, D-52): pays the gas, takes nothing. */
const MOCK_SPONSOR: Address = "0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402";
const sponsoredOn = (chainId: number) => defaultPaymasterMode(chainId) === "sponsored";

/**
 * Same shape as a real userOp receipt: on a Circle-paymaster chain the fee to the paymaster, the
 * transfer and the UserOperationEvent; on a sponsored testnet no fee transfer and a sponsor paymaster.
 */
function spendReceipt(chainId: number, s: MockSpendTx) {
  const cfg = getChainConfig(chainId);
  const sponsored = sponsoredOn(chainId);
  const paymaster = sponsored
    ? MOCK_SPONSOR
    : getAddress((CIRCLE_PAYMASTER_V08 as Record<number, Address>)[chainId] ?? "0x3BA9A96eE3eFf3A69E2B18886AcF52027EFF8966");
  const logs = [
    ...(sponsored ? [] : [transferLog(circleUsdcFor(chainId), s.from, paymaster, s.fee, 0)]),
    transferLog(cfg.usdc, s.from, s.to, s.amount, 1),
    {
      address: getAddress(ENTRYPOINT_V08),
      topics: encodeEventTopics({
        abi: userOperationEventAbi,
        eventName: "UserOperationEvent",
        args: { userOpHash: s.userOpHash, sender: s.from, paymaster },
      }) as Hex[],
      data: encodeAbiParameters(
        [{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }],
        [0n, true, 1_700_000_000_000n, 180_000n],
      ),
      logIndex: 2,
    },
  ];
  return { transactionHash: s.txHash, blockNumber: s.block, from: MOCK_BUNDLER, to: getAddress(ENTRYPOINT_V08), status: "success" as const, logs };
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
    /** Stealth addresses never hold ETH here; gas is paid in USDC by the (mock) paymaster. */
    async getBalance(_args: { address: Address }) {
      await latency();
      return 0n;
    },
    /** One nonce per 7702 authorization; stealth addresses send no transactions of their own. */
    async getTransactionCount(args: { address: Address }) {
      await latency();
      return state.delegated.has(args.address.toLowerCase()) ? 1 : 0;
    },
    async getCode(args: { address: Address }): Promise<Hex | undefined> {
      await latency();
      return state.delegated.has(args.address.toLowerCase()) ? (`0xef0100${SIMPLE_7702_ACCOUNT.slice(2).toLowerCase()}` as Hex) : undefined;
    },
    /** Receipts built from the mock world: pay runs (Transfer + Announcement per line) and mock spends. */
    async getTransactionReceipt(args: { hash: Hex }) {
      await latency();
      const spend = state.spendTxs.get(args.hash.toLowerCase());
      if (spend) return spendReceipt(chainId, spend);
      const lines = state.meta ? world(chainId).anns.filter((a) => a.txHash.toLowerCase() === args.hash.toLowerCase()) : [];
      if (lines.length === 0) throw new Error(`mock: transaction ${args.hash} not found`);
      const logs = lines.flatMap((a) => [
        ...(a.transfer ? [transferLog(cfg.usdc, a.transfer.from, a.stealthAddress, a.transfer.amount, a.logIndex - 1)] : []),
        {
          address: getAddress(ANNOUNCER),
          topics: encodeEventTopics({
            abi: announcerAbi,
            eventName: "Announcement",
            args: { schemeId: 1n, stealthAddress: a.stealthAddress, caller: a.caller },
          }) as Hex[],
          data: encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], [a.ephemeralPubKey, a.metadata]),
          logIndex: a.logIndex,
        },
      ]);
      const payer = lines.find((a) => a.transfer)?.transfer?.from ?? MOCK_EMPLOYER;
      return { transactionHash: args.hash, blockNumber: lines[0]!.blockNumber, from: payer, to: lines[0]!.caller, status: "success" as const, logs };
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

/** Records a mock userOp so `getTransactionReceipt` and the proof panel's reads see it. */
function recordSpend(from: Address, to: Address, amount: bigint, tag: string, fee = MOCK_FEE): { userOpHash: Hex; txHash: Hex } {
  const now = Date.now();
  const userOpHash = fakeTxHash(`${tag}op:${from}:${now}`);
  const txHash = fakeTxHash(`${tag}tx:${from}:${now}`);
  const block = state.world ? head(state.world.chainId) : 0n;
  state.delegated.add(from.toLowerCase());
  state.spendTxs.set(txHash.toLowerCase(), { txHash, userOpHash, from, to, amount, fee, block });
  return { userOpHash, txHash };
}

export function createMockSpendService(chainId?: number): SpendService {
  const delegated = state.delegated;
  const balanceOf = (a: string) => state.world?.balances.get(a.toLowerCase()) ?? 0n;
  // Sponsored testnet (D-52): no fee. Otherwise the Circle paymaster's USDC fee.
  const feeFor = () => (sponsoredOn(chainId ?? state.world?.chainId ?? 84532) ? 0n : MOCK_FEE);
  return {
    ready: true,
    async quote(stealthKey, _to): Promise<SpendQuote> {
      await latency();
      const from = privateKeyToAccount(stealthKey).address;
      const balance = balanceOf(from);
      const fee = feeFor() === 0n ? 0n : delegated.has(from.toLowerCase()) ? MOCK_FEE - 6_000n : MOCK_FEE;
      return { from, fee, balance, maxSendable: balance > fee ? balance - fee : 0n, delegated: delegated.has(from.toLowerCase()) };
    },
    async sendAll(spends: readonly SpendParams[], onProgress?: SendProgress): Promise<SpendResult[]> {
      const out: SpendResult[] = [];
      onProgress?.(0, spends.length);
      for (const [i, s] of spends.entries()) {
        if (i > 0) await sleep(600 + Math.random() * 900); // real sends wait 4-24 s
        const from = privateKeyToAccount(s.stealthKey).address;
        const bal = balanceOf(from);
        const fee = feeFor();
        const amount = s.amount === "max" ? bal - fee : s.amount;
        // Same contract as the SDK's spendMany: stop at the first failure, report what already landed.
        if (i === 1 && s.to.toLowerCase().startsWith(MOCK_FAIL_PREFIX)) {
          throw new SpendManyError(out, i, new Error("mock: bundler rejected the userOp (AA21 didn't pay prefund)"));
        }
        if (amount + fee > bal) throw new SpendManyError(out, i, new Error(`mock: insufficient balance in ${from}`));
        state.world?.balances.set(from.toLowerCase(), bal - amount - fee);
        const hashes = recordSpend(from, s.to, amount, "", fee);
        out.push({
          from,
          ...hashes,
          delegated: true,
          amount,
          feeEstimate: fee,
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

