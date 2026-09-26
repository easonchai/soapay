import { PARENT_NAME, SoapayNameError, inviteCodeHash, isBytes32, isValidLabel, parseInviteLink, pinnedMetaChanged, signNameClaim, signRegisterKeysOnBehalf } from "@soapay/sdk";
import { AGENT_CONTEXT_MAX, agentTextRecords, type AgentMetadata } from "@soapay/sdk/ensv2";
import { formatEther, type Hex } from "viem";
import { ApiError, type Ctx, type InviteRecord } from "../context.js";
import { checkAllowlist, normalizeName } from "../guardrails.js";
import { update } from "../state.js";
import { errorMessage, formatUsdc, ToolError } from "../util.js";

export function requireKeys(ctx: Ctx) {
  if (!ctx.keys) throw new ToolError("not_configured", "AGENT_MNEMONIC is not set, so this agent has no receiving identity");
  return ctx.keys;
}

export function requirePayer(ctx: Ctx) {
  if (!ctx.payer) throw new ToolError("not_configured", "AGENT_PAYER_PRIVATE_KEY is not set, so this agent can't pay");
  return ctx.payer;
}

/** Resolves a name through ENS + the ERC-6538 registry, without pinning. */
export async function resolve(ctx: Ctx, rawName: string) {
  const name = normalizeName(rawName);
  try {
    const r = await ctx.chain.resolveName(name);
    return { name, ...r };
  } catch (e) {
    if (e instanceof SoapayNameError) throw new ToolError(e.code === "NameNotFound" ? "name_not_found" : e.code === "NotRegistered" ? "name_not_registered" : "name_meta_mismatch", e.message);
    throw new ToolError("resolve_failed", `could not resolve ${name}: ${errorMessage(e)}`);
  }
}

/**
 * Resolve and pin (sender-app rule): the first resolution pins the meta-address; a later
 * different one is refused until the operator clears the pin in the state file.
 */
export async function resolvePinned(ctx: Ctx, rawName: string) {
  const r = await resolve(ctx, rawName);
  checkAllowlist(ctx.config.payeeAllowlist, { name: r.name });
  const pinned = ctx.state.read().pins[r.name];
  if (pinned && pinnedMetaChanged(pinned, r.metaAddressURI)) {
    ctx.log.warn("pinned meta-address changed", { name: r.name });
    throw new ToolError(
      "pin_changed",
      `${r.name} now resolves to a different meta-address than the one pinned at first use. Nothing was paid. ` +
        `If the owner really rotated keys, the operator must remove the pin from ${ctx.config.stateDir}/state.json.`,
      { name: r.name, pinned, current: r.metaAddressURI },
    );
  }
  if (!pinned) update(ctx.state, (d) => void (d.pins[r.name] = r.metaAddressURI));
  return { ...r, newlyPinned: !pinned };
}

export async function whoami(ctx: Ctx) {
  const st = ctx.state.read();
  const payer = ctx.payer;
  const [usdc, eth] = payer
    ? await Promise.all([ctx.chain.usdcBalance(payer).catch(() => null), ctx.chain.ethBalance(payer).catch(() => null)])
    : [null, null];
  const now = ctx.now();
  return {
    name: st.identity?.name ?? null,
    metaAddress: ctx.keys?.metaAddressURI ?? null,
    registrant: ctx.keys?.registrantAddress ?? null,
    payer: payer
      ? { address: payer, usdc: usdc === null ? null : formatUsdc(usdc), eth: eth === null ? null : formatEther(eth) }
      : null,
    chainId: ctx.config.chainId,
    guardrails: {
      maxPerCallUsdc: formatUsdc(ctx.config.maxPerCallUsdc),
      maxPerDayUsdc: formatUsdc(ctx.config.maxPerDayUsdc),
      remainingTodayUsdc: formatUsdc(ctx.caps.remainingToday(now)),
      payeeAllowlist: ctx.config.payeeAllowlist,
    },
    note:
      "Received funds sit in one-time stealth addresses; call `balance` or `scan` to see them." +
      (ctx.config.chainId === 84532 && payer && usdc === 0n ? " The payer holds no test USDC: call `get_test_funds`." : ""),
  };
}

export async function resolveName(ctx: Ctx, input: { name: string }) {
  const r = await resolve(ctx, input.name);
  const pinned = ctx.state.read().pins[r.name];
  return {
    name: r.name,
    metaAddress: r.metaAddressURI,
    registrant: r.registrant,
    pinned: pinned ? !pinnedMetaChanged(pinned, r.metaAddressURI) : null,
    allowlisted: ctx.config.payeeAllowlist ? ctx.config.payeeAllowlist.includes(r.name) : null,
  };
}

export const CLAIM_TTL_SECONDS = 3_600;

/** The ENSIP-26 `agent-context` value: JSON, so agents and humans can both read it. */
export function agentContext(p: { name: string; description?: string | undefined; capabilities?: readonly string[] | undefined; chainId: number }): string {
  const ctx = {
    name: p.name,
    description: p.description ?? "Soapay agent: receives and sends private USDC payments.",
    capabilities: p.capabilities ?? [],
    payments: {
      scheme: "ERC-5564 scheme 1 stealth addresses",
      metaAddressRecord: "stealth",
      registry: "ERC-6538 on chain " + p.chainId,
      how: `Resolve the "stealth" text record, derive a fresh stealth address, pay it and announce (e.g. through StealthDisperse).`,
    },
  };
  const s = JSON.stringify(ctx);
  if (s.length > AGENT_CONTEXT_MAX) throw new ToolError("invalid_input", "description and capabilities are too long for agent-context");
  return s;
}

/**
 * An employer invite, as the agent received it: the full link the company app copies
 * (`<recipient>/#/join?code=0x…&label=…&org=…`) or the bare 32-byte code.
 * Returns the code and the link's label hint; the API's invite record is the truth.
 */
export function parseInvite(raw: string): { code: Hex; labelHint: string | undefined } {
  const s = raw.trim();
  if (isBytes32(s)) return { code: s.toLowerCase() as Hex, labelHint: undefined };
  const parsed = parseInviteLink(s);
  if (!parsed) {
    throw new ToolError(
      "invalid_invite",
      "invite must be the invite link from the company app (…/#/join?code=0x…&label=…) or its 0x-prefixed 32-byte code",
    );
  }
  return { code: parsed.code, labelHint: parsed.label };
}

/** Looks the invite up on the API and settles the label: the invite's reserved label wins. */
async function resolveInvite(ctx: Ctx, raw: string, requestedLabel: string | undefined) {
  const { code, labelHint } = parseInvite(raw);
  const codeHash = inviteCodeHash(code);
  let inv: InviteRecord | null;
  try {
    inv = await ctx.api.getInvite(codeHash);
  } catch (e) {
    if (e instanceof ApiError) throw new ToolError(`invite_${e.code}`, `GET /invites failed: ${e.message}`);
    throw e;
  }
  if (!inv) throw new ToolError("invite_not_found", "the API doesn't know this invite; ask the employer for a fresh link");
  const reserved = inv.label.toLowerCase();
  if (requestedLabel && requestedLabel !== reserved) {
    throw new ToolError(
      "invite_label_mismatch",
      `this invite reserves ${reserved}.${PARENT_NAME}, not ${requestedLabel}.${PARENT_NAME}. ` +
        `Call again without a label (or with label "${reserved}") to join with it.`,
      { reservedLabel: reserved, requestedLabel },
    );
  }
  if (labelHint && labelHint !== reserved) ctx.log.warn("invite link label differs from the API's; using the API's", { codeHash });
  return { code, codeHash, label: reserved, status: inv.status, org: inv.org ?? null };
}

export async function createAgentIdentity(
  ctx: Ctx,
  input: {
    label?: string | undefined;
    invite?: string | undefined;
    description?: string | undefined;
    capabilities?: string[] | undefined;
    endpoints?: Record<string, string> | undefined;
  },
) {
  const keys = requireKeys(ctx);
  const requested = input.label?.toLowerCase();
  if (requested !== undefined && !isValidLabel(requested)) {
    throw new ToolError("invalid_label", "label must be 3-32 of [a-z0-9-], no leading/trailing hyphen");
  }
  const invite = input.invite ? await resolveInvite(ctx, input.invite, requested) : null;
  const label = invite?.label ?? requested;
  if (!label) throw new ToolError("invalid_input", "pass a label, or an invite link from the employer (which carries the label)");
  const name = `${label}.${PARENT_NAME}`;
  const joined = invite ? { org: invite.org, codeHash: invite.codeHash } : undefined;

  const existing = await ctx.api.getName(label);
  if (existing) {
    if (existing.registrant.toLowerCase() !== keys.registrantAddress.toLowerCase()) {
      throw new ToolError("label_taken", `${name} belongs to someone else`);
    }
    update(ctx.state, (d) => void (d.identity = { label, name, registrant: keys.registrantAddress }));
    return {
      name,
      metaAddress: keys.metaAddressURI,
      registrant: keys.registrantAddress,
      created: false,
      txHash: existing.txHash,
      records: null,
      invite: joined ?? null,
    };
  }
  if (invite && invite.status !== "pending") {
    throw new ToolError(
      invite.status === "claimed" ? "invite_claimed" : "invite_expired",
      invite.status === "claimed"
        ? "this invite was already used by someone else; ask the employer for a new one"
        : "this invite has expired; ask the employer for a new one",
    );
  }

  const agent: AgentMetadata = {
    context: agentContext({ name, description: input.description, capabilities: input.capabilities, chainId: ctx.config.chainId }),
    ...(input.endpoints && Object.keys(input.endpoints).length ? { endpoints: input.endpoints } : {}),
  };
  let records;
  try {
    records = agentTextRecords(agent);
  } catch (e) {
    throw new ToolError("invalid_input", errorMessage(e));
  }

  // 1. Sponsored ERC-6538 registration (the registrant key signs; the API relays).
  let registration: { txHash: string; status: string } | { status: "already_registered" };
  try {
    const nonce = await ctx.chain.registryNonce(keys.registrantAddress);
    const signature = await signRegisterKeysOnBehalf({
      registrantKey: keys.registrantKey,
      metaAddressURI: keys.metaAddressURI,
      chainId: ctx.config.chainId,
      nonce,
    });
    registration = await ctx.api.register({ registrant: keys.registrantAddress, metaAddress: keys.metaAddressURI, signature });
  } catch (e) {
    if (e instanceof ApiError && e.code === "already_registered") registration = { status: "already_registered" };
    else if (e instanceof ApiError) throw new ToolError(`register_${e.code}`, `POST /register failed: ${e.message}`);
    else throw e;
  }

  // 2. Claim the ENSv2 subname with the agent records, set once at issuance.
  const deadline = BigInt(ctx.now() + CLAIM_TTL_SECONDS);
  const signature = await signNameClaim({
    label,
    registrant: keys.registrantAddress,
    metaAddress: keys.metaAddressURI,
    deadline,
    chainId: ctx.config.chainId,
    registrantKey: keys.registrantKey,
  });
  let rec;
  try {
    rec = await ctx.api.claimName({
      label,
      registrant: keys.registrantAddress,
      metaAddress: keys.metaAddressURI,
      deadline: deadline.toString(),
      signature,
      agent,
      ...(invite ? { inviteCode: invite.code } : {}),
    });
  } catch (e) {
    if (e instanceof ApiError) throw new ToolError(`names_${e.code}`, `POST /names failed: ${e.message}`);
    throw e;
  }
  update(ctx.state, (d) => void (d.identity = { label, name, registrant: keys.registrantAddress }));
  ctx.log.info("agent identity created", { name, registrant: keys.registrantAddress, ...(invite ? { invite: invite.codeHash } : {}) });
  return {
    name: rec.name,
    metaAddress: keys.metaAddressURI,
    registrant: keys.registrantAddress,
    created: true,
    registration,
    txHash: rec.txHash,
    records: Object.fromEntries(records.map((r) => [r.key, r.value])),
    invite: joined ?? null,
  };
}

export { checkAllowlist };
