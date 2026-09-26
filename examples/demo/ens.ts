// The ENS beat, in a terminal: ENS text records are what an employer reads to derive a fresh payment
// address for every payment. Every value below is a live read (ENSv2 on Ethereum Sepolia, ERC-6538 on
// Base Sepolia); nothing is sent and no key is involved. Entry point: scripts/demo-ens.ts.
//
//   pnpm demo:ens alex-demo              label under soapay.eth
//   pnpm demo:ens infra-agent.soapay.eth --derive 5
//
// RPCs: RPC_URL (Base Sepolia) and ENS_RPC_URL or L1_RPC_URL (Sepolia), from the environment, then
// scripts/.demo-agent.local.env, then apps/api/.env (under SOAPAY_ENV_ROOT, default the repo), then
// public endpoints. Only the RPC host is printed: provider URLs carry API keys.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, getAddress, http, zeroAddress, type Address, type Hex } from "viem";
import {
  ERC6538_REGISTRY,
  erc6538RegistryMinimalAbi,
  getChain,
  PARENT_NAME,
  parseMetaAddress,
  TEXT_KEY_REGISTRANT,
  TEXT_KEY_STEALTH,
} from "@soapay/sdk";
import {
  EAC_ALL_ROLES,
  EAC_ROOT_RESOURCE,
  ENSV2_SEPOLIA,
  labelId,
  permissionedRegistryAbi,
  permissionedResolverAbi,
  REGISTRY_STATUS,
  RESOLVER_ROLES,
  STEALTH_WRITER_RESOURCE,
  TEXT_KEY_AGENT_CONTEXT,
  agentEndpointKey,
} from "@soapay/sdk/ensv2";
import { REPO } from "./local.js";
import {
  deriveFreshAddresses,
  hasRole,
  metaUri,
  parseArgs,
  parseEnvText,
  registryPath,
  resolverRoleNames,
  rpcHost,
  shortHex,
  splitMetaAddress,
  toEnsName,
} from "./ens-view.js";

// ---------------------------------------------------------------------------------------------
// Output (same look as agent.ts)

const color = !process.env.NO_COLOR && (process.stdout.isTTY || !!process.env.FORCE_COLOR);
const sgr = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const k = {
  bold: sgr("1"),
  dim: sgr("2"),
  green: sgr("1;32"),
  red: sgr("1;31"),
  yellow: sgr("1;33"),
  cyan: sgr("1;36"),
  blue: sgr("1;34"),
  tag: sgr("1;30;46"),
};
const out = (s = "") => process.stdout.write(`${s}\n`);
const line = (s: string) => out(`   ${s}`);
const kv = (key: string, value: string) => line(`${k.dim(key.padEnd(23))} ${value}`);
const ok = (s: string) => out(`   ${k.green("✓")} ${s}`);
const bad = (s: string) => out(`   ${k.red("✗")} ${s}`);
const why = (s: string) => line(k.dim(s));
function step(n: number | string, title: string, explain: string): void {
  out("");
  out(`${k.cyan("▸")} ${k.tag(` ${n} `)} ${k.bold(title)}`);
  why(explain);
}

// ---------------------------------------------------------------------------------------------
// Config

const ENV_ROOT = process.env.SOAPAY_ENV_ROOT ?? REPO;
const readEnv = (rel: string) => {
  const p = resolve(ENV_ROOT, rel);
  return existsSync(p) ? parseEnvText(readFileSync(p, "utf8")) : {};
};
const agentEnv = readEnv("scripts/.demo-agent.local.env");
const apiEnv = readEnv("apps/api/.env");

const CHAIN_ID = 84532;
const cfg = getChain(CHAIN_ID);
const BASE_RPC = process.env.RPC_URL || agentEnv.RPC_URL || apiEnv.RPC_URL || cfg.chain.rpcUrls.default.http[0]!;
const ENS_RPC =
  process.env.ENS_RPC_URL ||
  process.env.L1_RPC_URL ||
  agentEnv.ENS_RPC_URL ||
  apiEnv.ENS_RPC_URL ||
  apiEnv.L1_RPC_URL ||
  "https://ethereum-sepolia-rpc.publicnode.com";
const ens = createPublicClient({ chain: cfg.ensChain!, transport: http(ENS_RPC, { retryCount: 3 }) });
const base = createPublicClient({ chain: cfg.chain, transport: http(BASE_RPC, { retryCount: 3 }) });

const ETHERSCAN = "https://sepolia.etherscan.io/address/";
const BASESCAN = "https://sepolia.basescan.org/address/";

/** Agent keys worth probing: text records can't be listed, so we ask for the ENSIP-26 ones we issue. */
const AGENT_KEYS = [TEXT_KEY_AGENT_CONTEXT, ...["mcp", "web", "a2a", "http", "https", "openapi"].map(agentEndpointKey)];

// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const { target, derive } = parseArgs(process.argv.slice(2));
  const name = toEnsName(target);

  out(k.bold(`Soapay × ENS: how ${name} gets paid`) + k.dim(`   (read-only, live)`));
  out(k.dim(`ENS on Ethereum Sepolia via ${rpcHost(ENS_RPC)} · ERC-6538 on Base Sepolia via ${rpcHost(BASE_RPC)}`));

  // 1. Resolve --------------------------------------------------------------------------------
  step(1, "Resolve", "Walk the ENSv2 registry tree from the root, one registry per label, to the name's own resolver.");
  const path = registryPath(name);
  let registry: Address = ENSV2_SEPOLIA.rootRegistry;
  kv("root registry", `${registry} ${k.dim("(ENSv2)")}`);
  let suffix = "";
  for (const label of path.slice(0, -1)) {
    suffix = suffix ? `${label}.${suffix}` : label;
    registry = (await ens.readContract({ address: registry, abi: permissionedRegistryAbi, functionName: "getSubregistry", args: [label] })) as Address;
    if (registry === zeroAddress) throw new Error(`${suffix} has no subregistry: ${name} does not exist`);
    kv(`${suffix} registry`, `${registry}${suffix === PARENT_NAME ? k.dim("  (Soapay's own UserRegistry)") : ""}`);
  }
  const label = path.at(-1)!;
  const state = await ens.readContract({ address: registry, abi: permissionedRegistryAbi, functionName: "getState", args: [labelId(label)] });
  if (state.status !== REGISTRY_STATUS.REGISTERED) throw new Error(`${name} is not registered (status ${state.status})`);
  const resolver = (await ens.readContract({ address: registry, abi: permissionedRegistryAbi, functionName: "getResolver", args: [label] })) as Address;
  if (resolver === zeroAddress) throw new Error(`${name} has no resolver`);
  kv(`${label} resolver`, k.blue(resolver));
  line(`${" ".repeat(24)}${k.dim(ETHERSCAN + resolver)}`);
  kv("owner (name token)", `${state.latestOwner}`);
  kv("expiry", state.expiry === (1n << 64n) - 1n ? "never (2^64-1)" : String(state.expiry));
  why("One Permissioned Resolver per name: its permissions (below) cover this name and nothing else.");
  const universal = await ens.getEnsResolver({ name }).catch(() => null);
  if (universal && getAddress(universal) === getAddress(resolver)) ok("ENS's Universal Resolver finds the same resolver: any ENS-aware tool reads these records");
  else if (universal) bad(`Universal Resolver answered ${universal}`);

  // 2. Records --------------------------------------------------------------------------------
  step(2, "Records", "The employer's app reads text records, not an address.");
  const text = (key: string) => ens.getEnsText({ name, key }).catch(() => null);
  const [stealth, registrantText, addr, ...agent] = await Promise.all([
    text(TEXT_KEY_STEALTH),
    text(TEXT_KEY_REGISTRANT),
    ens.getEnsAddress({ name }).catch(() => null),
    ...AGENT_KEYS.map(text),
  ]);
  if (!stealth) throw new Error(`${name} has no "${TEXT_KEY_STEALTH}" record`);
  const meta = splitMetaAddress(stealth);
  kv(`text ${TEXT_KEY_STEALTH}`, `${shortHex(metaUri(meta.metaAddress), 20, 8)} ${k.dim(`(${stealth.length} chars, ERC-5564 meta-address)`)}`);
  kv("  spending pubkey", `${meta.spendingPublicKey}`);
  kv("  viewing pubkey", `${meta.viewingPublicKey}`);
  why("Two public keys, no address: enough for anyone to create a new address for this person, nothing more.");
  const registrant = registrantText && /^0x[0-9a-fA-F]{40}$/.test(registrantText.trim()) ? getAddress(registrantText.trim()) : null;
  kv(`text ${TEXT_KEY_REGISTRANT}`, registrant ?? k.red(registrantText ? "malformed" : "missing"));
  why("A throwaway address derived from the same recovery phrase. It holds no funds; it anchors the cross-check.");
  let agentShown = 0;
  AGENT_KEYS.forEach((key, i) => {
    const v = agent[i];
    if (!v) return;
    agentShown++;
    kv(`text ${key}`, v.length > 90 ? `${v.slice(0, 87)}…` : v);
  });
  if (agentShown) why("ENSIP-26 agent records: an agent is discoverable by name, with the same stealth rule as people.");
  kv("addr (ETH)", addr ? k.red(addr) : `${k.yellow("none")}`);
  why("No fixed address, on purpose: a plain wallet can't pay one static, linkable address.");

  // 3. Permissions ----------------------------------------------------------------------------
  step(3, "Permissions", `Enhanced Access Control on the resolver: who may rewrite "${TEXT_KEY_STEALTH}".`);
  if (registrant) {
    const [scoped, rootRoles] = await Promise.all([
      ens.readContract({ address: resolver, abi: permissionedResolverAbi, functionName: "roles", args: [STEALTH_WRITER_RESOURCE, registrant] }),
      ens.readContract({ address: resolver, abi: permissionedResolverAbi, functionName: "roles", args: [EAC_ROOT_RESOURCE, registrant] }),
    ]);
    kv("resource", `keccak256("${TEXT_KEY_STEALTH}") = ${shortHex(`0x${STEALTH_WRITER_RESOURCE.toString(16).padStart(64, "0")}`, 12, 8)}`);
    if (hasRole(scoped, RESOLVER_ROLES.ROLE_SET_TEXT)) ok(`registrant ${shortHex(registrant)} holds ROLE_SET_TEXT on that resource only`);
    else line(`${k.yellow("•")} the registrant holds no stealth-writer role here; the writer is another account (e.g. the World ID guard)`);
    const extra = resolverRoleNames(rootRoles);
    if (extra.length === 0) ok("and nothing on the resolver root: it can't touch any other record");
    else bad(`it also holds root roles: ${extra.join(", ")}`);
  }
  const soapayOwner = await ens
    .readContract({ address: ENSV2_SEPOLIA.ethRegistry, abi: permissionedRegistryAbi, functionName: "getState", args: [labelId(PARENT_NAME.split(".")[0]!)] })
    .then((s) => s.latestOwner)
    .catch(() => null);
  if (soapayOwner && name.endsWith(`.${PARENT_NAME}`)) {
    const adminRoles = await ens.readContract({ address: resolver, abi: permissionedResolverAbi, functionName: "roles", args: [EAC_ROOT_RESOURCE, soapayOwner] });
    kv(`${PARENT_NAME} owner`, `${shortHex(soapayOwner)} ${k.dim(`${hasRole(adminRoles, EAC_ALL_ROLES) ? "holds every root role" : "root roles: " + (resolverRoleNames(adminRoles).join(", ") || "none")} (the company, trusted)`)}`);
  }
  why("The name's owner can't transfer it or swap its resolver; the company can revoke it (e.g. when someone leaves).");

  // 4. Cross-check ----------------------------------------------------------------------------
  step(4, "Cross-check", "ERC-6538 on Base Sepolia keeps the chain-local copy; the payer pins only when both agree.");
  if (!registrant) {
    bad("no registrant record, nothing to cross-check");
  } else {
    const onchain = (await base.readContract({
      address: ERC6538_REGISTRY,
      abi: erc6538RegistryMinimalAbi,
      functionName: "stealthMetaAddressOf",
      args: [registrant, 1n],
    })) as Hex;
    kv("registry", `${ERC6538_REGISTRY} ${k.dim(BASESCAN + ERC6538_REGISTRY)}`);
    kv("stealthMetaAddressOf", `(${shortHex(registrant)}, scheme 1)`);
    if (!onchain || onchain === "0x") bad("no ERC-6538 entry: the employer's app refuses to pay this name");
    else if (onchain.toLowerCase() === parseMetaAddress(stealth)) ok(`${shortHex(onchain, 12, 8)} equals the ENS "${TEXT_KEY_STEALTH}" record → pin it`);
    else bad(`${shortHex(onchain, 12, 8)} differs from ENS: the employer's app blocks the line`);
  }

  // 5. Derive ---------------------------------------------------------------------------------
  step(5, "Derive", `${derive} fresh addresses, the way the employer's pay run makes each line.`);
  why("Random ephemeral key → ECDH with the viewing pubkey → shared secret → spending pubkey tweaked → address.");
  const fresh = deriveFreshAddresses(stealth, derive);
  out("");
  line(k.dim(`${"#".padEnd(3)}${"stealth address".padEnd(44)}${"view tag".padEnd(10)}ephemeral pubkey (announced)`));
  fresh.forEach((f, i) => {
    line(`${String(i + 1).padEnd(3)}${k.green(f.stealthAddress)}  ${`0x${f.viewTag.toString(16).padStart(2, "0")}`.padEnd(10)}${shortHex(f.ephemeralPublicKey, 14, 8)}`);
  });
  out("");
  ok(`${new Set(fresh.map((f) => f.stealthAddress)).size} distinct addresses, unlinkable to each other and to ${name}`);
  why("Nothing on-chain ties them together: each line is a new address with its own ephemeral key.");
  why("Only the viewing key finds them (the view tag skips 255/256 of announcements); only the spending key spends.");
  why("Run it again and every address changes: the employer never caches a stealth address, only the meta-address.");
}

try {
  await main();
} catch (e) {
  const msg = (e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : String(e)).split("\n")[0]!;
  // Error text from viem can echo the RPC URL; show hosts only.
  const safe = [ENS_RPC, BASE_RPC].reduce((acc, url) => acc.split(url).join(rpcHost(url)), msg);
  console.error(`${k.red("demo-ens:")} ${safe}`);
  process.exit(1);
}
