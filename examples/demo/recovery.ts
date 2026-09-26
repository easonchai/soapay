// The World ID recovery beat (docs/demo-flow.md): a thief with a stolen recovery phrase rewrites the
// victim's ENS `stealth` record directly, bypassing Soapay, and the payer's pin check still blocks
// the line because no World ID attestation covers the change.
//
// Used by scripts/demo-attacker.ts and scripts/demo-recovery-check.ts. Never prints a phrase or key.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createWalletClient,
  encodeFunctionData,
  formatEther,
  http,
  isHex,
  parseAbi,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type PublicClient,
  type Transport,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildSetStealthRecordCall,
  ERC6538_REGISTRY,
  erc6538RegistryMinimalAbi,
  generateMnemonic,
  getRegistryNonce,
  keysFromMnemonic,
  parseMetaAddress,
  PARENT_NAME,
  resolveStealthMeta,
  rotationClaimTypedData,
  signRegisterKeysOnBehalf,
  TEXT_KEY_REGISTRANT,
  TEXT_KEY_STEALTH,
  validateMnemonic,
  type RegistryReader,
} from "@soapay/sdk";
import { BASE_RPC_URL, baseClient, CHAIN_ID, ENS_RPC_URL, ensClient } from "./claim.js";
import { c, recoveryEntries, REPO, short } from "./local.js";

export const API_URL = (process.env.API_URL ?? process.env.SOAPAY_API ?? "https://soapay.up.railway.app/api").replace(/\/+$/, "");
export const DRY = /^(1|true|yes)$/i.test(process.env.DEMO_DRY ?? "");
export const DEFAULT_VICTIM = "sam-demo";

/** ERC-6538 `registerKeys`: the registrant writes its own entry and pays its own gas (no relayer). */
const registerKeysAbi = parseAbi(["function registerKeys(uint256 schemeId, bytes stealthMetaAddress)"]);

export type TxLink = { what: string; chain: "sepolia" | "base-sepolia"; hash: Hash; url: string };

// ---------------------------------------------------------------------------------------------
// Secrets: the victim's phrase and the demo's funding wallets. Values are never printed.

/**
 * The victim's recovery phrase: `DEMO_VICTIM_PHRASE`, or the `recovery` entry for `label` in the
 * git-ignored scripts/.demo-recipients.local.json (SOAPAY_DEMO_FILE overrides the path).
 */
export function stolenPhrase(label: string): string {
  const fromEnv = process.env.DEMO_VICTIM_PHRASE?.trim();
  const phrase = fromEnv || recoveryEntries().find((e) => e.label === label)?.phrase;
  if (!phrase) throw new Error(`no phrase for ${label}: run scripts/demo-setup-recovery.ts first, or set DEMO_VICTIM_PHRASE`);
  if (!validateMnemonic(phrase)) throw new Error(`the stored phrase for ${label} is not a valid BIP-39 phrase`);
  return phrase;
}

/** Where the git-ignored env files live (contracts/.env, apps/api/.env). */
const ENV_ROOT = process.env.SOAPAY_ENV_ROOT ?? REPO;

function readEnvFile(rel: string): Record<string, string> {
  const path = resolve(ENV_ROOT, rel);
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
  return out;
}

type Funder = { source: string; account: Account };

/** Wallets we control that may pay the stolen registrant's gas, in order. Env overrides first. */
function funders(net: "sepolia" | "base-sepolia"): Funder[] {
  const contracts = readEnvFile("contracts/.env");
  const api = readEnvFile("apps/api/.env");
  const candidates: [string, string | undefined][] =
    net === "sepolia"
      ? [
          ["DEMO_FUNDER_PRIVATE_KEY", process.env.DEMO_FUNDER_PRIVATE_KEY],
          // The soapay.eth owner first: the L1 relayer is the live API's hot key, and sharing its nonce races the API.
          ["soapay.eth owner, contracts/.env", contracts.PARENT_OWNER_PRIVATE_KEY],
          ["L1 relayer, apps/api/.env", api.L1_RELAYER_PRIVATE_KEY],
        ]
      : [
          ["DEMO_BASE_FUNDER_PRIVATE_KEY", process.env.DEMO_BASE_FUNDER_PRIVATE_KEY],
          ["deployer, contracts/.env", contracts.DEPLOYER_PRIVATE_KEY],
          ["relayer, apps/api/.env", api.RELAYER_PRIVATE_KEY],
        ];
  return candidates
    .filter((x): x is [string, string] => !!x[1] && isHex(x[1]) && x[1].length === 66)
    .map(([source, key]) => ({ source, account: privateKeyToAccount(key as Hex) }));
}

// ---------------------------------------------------------------------------------------------
// Chain helpers

type Net = { name: "sepolia" | "base-sepolia"; client: PublicClient<Transport, Chain>; chain: Chain; rpc: string; explorer: string };
const L1: Net = { name: "sepolia", client: ensClient, chain: ensClient.chain, rpc: ENS_RPC_URL, explorer: "https://sepolia.etherscan.io/tx/" };
const L2: Net = { name: "base-sepolia", client: baseClient, chain: baseClient.chain, rpc: BASE_RPC_URL, explorer: "https://sepolia.basescan.org/tx/" };

const wallet = (net: Net, account: Account) => createWalletClient({ account, chain: net.chain, transport: http(net.rpc, { retryCount: 3 }) });

async function sendAndWait(net: Net, account: Account, what: string, tx: { to: Address; data?: Hex; value?: bigint }): Promise<TxLink> {
  const hash = await wallet(net, account).sendTransaction({ to: tx.to, data: tx.data, value: tx.value });
  const receipt = await net.client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${what} reverted: ${net.explorer}${hash}`);
  const link: TxLink = { what, chain: net.name, hash, url: `${net.explorer}${hash}` };
  console.log(`  ${c.green("ok")}  ${what.padEnd(34)} ${c.dim(link.url)}`);
  return link;
}

/**
 * Makes sure `who` can pay for `call`, topping it up from a demo wallet when it can't. Sends enough
 * for two calls of that size (the attack and the --restore), minus what it already holds.
 */
async function ensureGas(net: Net, who: Address, call: { to: Address; data: Hex }): Promise<TxLink | undefined> {
  const [gas, fees, balance] = await Promise.all([
    net.client.estimateGas({ account: who, to: call.to, data: call.data }),
    net.client.estimateFeesPerGas(),
    net.client.getBalance({ address: who }),
  ]);
  // Headroom: viem re-estimates at send time with its own fee multiplier, and Sepolia base fees move.
  const execution = ((gas * 3n) / 2n) * (((fees.maxFeePerGas ?? fees.gasPrice ?? 0n) * 3n) / 2n);
  // Base adds an L1 data fee that estimateFeesPerGas does not include: keep a small floor.
  const perTx = net.name === "base-sepolia" && execution < 10_000_000_000_000n ? 10_000_000_000_000n : execution;
  if (balance >= perTx) return undefined;
  const amount = perTx * 2n - balance;
  for (const f of funders(net.name)) {
    if ((await net.client.getBalance({ address: f.account.address })) < amount * 3n) continue;
    console.log(`  ${c.dim(`gas: ${DRY ? "would send" : "sending"} ${formatEther(amount)} ETH on ${net.name} to the stolen registrant from ${f.account.address} (${f.source}); a real thief brings their own`)}`);
    if (DRY) return undefined;
    return sendAndWait(net, f.account, `gas top-up (${net.name})`, { to: who, value: amount });
  }
  throw new Error(`${who} needs ${formatEther(amount)} ETH on ${net.name} and no demo funder has enough (see examples/demo/recovery.ts)`);
}

// ---------------------------------------------------------------------------------------------
// Reads

export type NameState = { name: string; stealth: string | null; registrant: string | null; resolver: Address; erc6538: Hex };

export async function readNameState(label: string, registrant: Address): Promise<NameState> {
  const name = `${label}.${PARENT_NAME}`;
  const [stealth, reg, resolver, erc6538] = await Promise.all([
    ensClient.getEnsText({ name, key: TEXT_KEY_STEALTH }),
    ensClient.getEnsText({ name, key: TEXT_KEY_REGISTRANT }),
    ensClient.getEnsResolver({ name }),
    baseClient.readContract({ address: ERC6538_REGISTRY, abi: erc6538RegistryMinimalAbi, functionName: "stealthMetaAddressOf", args: [registrant, 1n] }),
  ]);
  return { name, stealth, registrant: reg, resolver, erc6538 };
}

const sameMeta = (a: string | null | undefined, b: string) => {
  try {
    return !!a && parseMetaAddress(a) === parseMetaAddress(b);
  } catch {
    return false;
  }
};

/** Polls until the name resolves (ENS record and, unless ensOnly, ERC-6538 agree) to `meta`. Public RPCs lag. */
export async function waitForResolution(label: string, meta: string, opts: { ensOnly?: boolean } = {}): Promise<void> {
  const name = `${label}.${PARENT_NAME}`;
  for (let i = 0; i < 40; i++) {
    try {
      const got = opts.ensOnly
        ? await ensClient.getEnsText({ name, key: TEXT_KEY_STEALTH })
        : (await resolveStealthMeta({ ensClient, baseClient: baseClient as unknown as RegistryReader, name })).metaAddressURI;
      if (sameMeta(got, meta)) return;
    } catch {
      // MetaMismatch while one chain catches up with the other; retry.
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`${name} did not resolve to ${short(meta)} in time`);
}

// ---------------------------------------------------------------------------------------------
// Writes, all from the victim's own (stolen) registrant key

/** Points the victim's `stealth` record and/or ERC-6538 entry at `meta`. */
async function repoint(label: string, phrase: string, meta: string, opts: { ens: boolean; registry: boolean; tag: string }): Promise<TxLink[]> {
  const registrant = privateKeyToAccount(keysFromMnemonic(phrase).registrantKey);
  const state = await readNameState(label, registrant.address);
  const txs: TxLink[] = [];

  // Ethereum Sepolia: setText("stealth") on the victim's own PermissionedResolver. The registrant holds
  // ROLE_SET_TEXT on the `stealth` resource (contracts/ENSV2.md §2); no Soapay code is involved.
  if (opts.ens) {
    const call = buildSetStealthRecordCall({ name: state.name, metaAddress: meta, resolver: state.resolver });
    const topUp = await ensureGas(L1, registrant.address, call);
    if (topUp) txs.push(topUp);
    if (DRY) console.log(`  ${c.dim(`dry run: would send setText(${state.name}, "stealth", ${short(meta)}) to ${state.resolver} from ${registrant.address}`)}`);
    else txs.push(await sendAndWait(L1, registrant, `${opts.tag}: ENS setText(stealth)`, call));
  }

  // Base Sepolia: the ERC-6538 entry, so the name still passes resolveStealthMeta's registry cross-check
  // and the payer sees a clean pin change, exactly like a legitimate rotation minus the attestation.
  if (opts.registry) {
    const call = { to: ERC6538_REGISTRY, data: encodeFunctionData({ abi: registerKeysAbi, functionName: "registerKeys", args: [1n, parseMetaAddress(meta)] }) };
    const topUp = await ensureGas(L2, registrant.address, call);
    if (topUp) txs.push(topUp);
    if (DRY) console.log(`  ${c.dim(`dry run: would send ERC-6538 registerKeys(1, ${short(meta)}) from ${registrant.address}`)}`);
    else txs.push(await sendAndWait(L2, registrant, `${opts.tag}: ERC-6538 registerKeys`, call));
  }
  return txs;
}

/** What the API said when asked to attest the hijack without a World ID proof. */
export type ApiProbe = { status: number; code: string; message: string } | { skipped: string };

/**
 * Asks POST /names/:label/rotation to attest the hijack. Everything is valid except the World ID
 * proof, which the thief can't produce: a real RotationClaim and ERC-6538 signature from the stolen
 * key, and no `worldIdResult`. The API refuses before it signs anything.
 */
export async function probeRotationApi(label: string, phrase: string, attackerMeta: string): Promise<ApiProbe> {
  if (DRY) return { skipped: "dry run" };
  const victim = keysFromMnemonic(phrase);
  const cur = (await fetch(`${API_URL}/names/${label}`).then((r) => r.json())) as { metaAddress?: string };
  const oldMeta = cur.metaAddress ?? victim.metaAddressURI;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const registrantSig = await privateKeyToAccount(victim.registrantKey).signTypedData(
    rotationClaimTypedData({ label, oldMeta, newMeta: attackerMeta, deadline, chainId: CHAIN_ID }),
  );
  const nonce = await getRegistryNonce(baseClient as unknown as RegistryReader, victim.registrantAddress);
  const registerSig = await signRegisterKeysOnBehalf({ registrantKey: victim.registrantKey, metaAddressURI: attackerMeta, chainId: CHAIN_ID, nonce });
  const res = await fetch(`${API_URL}/names/${label}/rotation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newMeta: attackerMeta, deadline: deadline.toString(), registrantSig, registerSig }),
  });
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (res.ok) throw new Error(`the API attested a rotation without a World ID proof (HTTP ${res.status}); this must never happen`);
  return { status: res.status, code: body?.error?.code ?? "?", message: body?.error?.message ?? "" };
}

export type AttackResult = { name: string; victimMeta: string; attackerMeta: string; txs: TxLink[]; api: ApiProbe };

/**
 * The attack: derive the victim's keys from the stolen phrase, make fresh attacker keys (memory only),
 * repoint the victim's name at them, then ask Soapay for an attestation (refused).
 */
export async function hijack(label: string, phrase: string, opts: { ensOnly?: boolean; probeApi?: boolean } = {}): Promise<AttackResult> {
  const victim = keysFromMnemonic(phrase);
  const name = `${label}.${PARENT_NAME}`;
  const before = await readNameState(label, victim.registrantAddress);
  const regMatches = before.registrant?.toLowerCase() === victim.registrantAddress.toLowerCase();
  console.log(c.bold(`1. Victim ${name}: keys derived from the stolen recovery phrase`));
  console.log(`  registrant        ${victim.registrantAddress}  ${c.dim(regMatches ? "(= the name's soapay:registrant record)" : "(does NOT match soapay:registrant!)")}`);
  console.log(`  stealth record    ${before.stealth ? short(before.stealth) : "(none)"}  ${c.dim(sameMeta(before.stealth, victim.metaAddressURI) ? "(the victim's own keys)" : "(not the victim's keys: hijacked already?)")}`);
  console.log(`  resolver          ${before.resolver}`);
  if (!regMatches) throw new Error(`${name}'s registrant is not the key behind this phrase`);

  // Fresh attacker keys. The phrase exists only in this process and is never written or printed.
  const attackerMeta = keysFromMnemonic(generateMnemonic()).metaAddressURI;
  console.log(c.bold("2. Attacker keys: a fresh recovery phrase, kept in memory only"));
  console.log(`  meta-address      ${short(attackerMeta)}`);

  console.log(c.bold(`3. Rewrite ${name} on-chain with the stolen registrant key (no Soapay app, no API)`));
  const txs = await repoint(label, phrase, attackerMeta, { ens: true, registry: !opts.ensOnly, tag: "attack" });
  if (!DRY) {
    await waitForResolution(label, attackerMeta, { ensOnly: !!opts.ensOnly });
    console.log(`  ${name} now resolves to ${short(attackerMeta)} ${c.dim("(the attacker's keys)")}`);
  }

  let api: ApiProbe = { skipped: "--no-api" };
  if (opts.probeApi !== false) {
    console.log(c.bold("4. Ask Soapay to attest the change: valid claim signature, no World ID proof"));
    api = await probeRotationApi(label, phrase, attackerMeta);
    console.log("skipped" in api ? `  ${c.dim(`skipped (${api.skipped})`)}` : `  POST /names/${label}/rotation → ${api.status} ${c.cyan(api.code)} ${c.dim(api.message)}`);
  }
  return { name, victimMeta: victim.metaAddressURI, attackerMeta, txs, api };
}

/** Puts the victim's own meta-address back (same stolen registrant key), so the demo can be re-run. */
export async function restore(label: string, phrase: string): Promise<TxLink[]> {
  const victim = keysFromMnemonic(phrase);
  const name = `${label}.${PARENT_NAME}`;
  const before = await readNameState(label, victim.registrantAddress);
  const ens = !sameMeta(before.stealth, victim.metaAddressURI);
  const registry = !sameMeta(before.erc6538, victim.metaAddressURI);
  console.log(c.bold(`Restore ${name} to the victim's own meta-address ${short(victim.metaAddressURI)}`));
  if (!ens && !registry) {
    console.log(`  ${c.dim("already the victim's keys; nothing to send")}`);
    return [];
  }
  const txs = await repoint(label, phrase, victim.metaAddressURI, { ens, registry, tag: "restore" });
  if (!DRY) {
    await waitForResolution(label, victim.metaAddressURI);
    console.log(`  ${name} resolves to the victim's keys again`);
  }
  return txs;
}
