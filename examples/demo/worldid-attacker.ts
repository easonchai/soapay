// The World ID failure path, scripted (docs/worldid.md, "Failure path"). Entry point:
// scripts/demo-attacker-worldid.ts.
//
//   pnpm demo:attacker-worldid [label]            the thief presents a World ID proof from ANOTHER person's
//                                                 session → 403 session_mismatch (default label sam-demo)
//   pnpm demo:attacker-worldid [label] --replay   the thief replays the victim's own captured proof
//                                                 → 403 session_replayed
//   pnpm demo:attacker-worldid [label] --setup    rehearsal, once: link the victim's name to YOUR real
//                                                 World ID (QR in the terminal) and keep that proof for --replay
//
// Nothing here writes on-chain, and a refused attempt changes nothing in the API. The victim's phrase comes
// from the git-ignored scripts/.demo-recipients.local.json (or DEMO_VICTIM_PHRASE) and is never printed;
// the thief's own keys exist only in memory. Env: API_URL, ENS_RPC_URL, RPC_URL, SOAPAY_DEMO_FILE,
// SOAPAY_ATTESTER, DEMO_DRY=1 (build everything, send nothing).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import {
  attachSessionTypedData,
  checkMetaPin,
  generateMnemonic,
  getRegistryNonce,
  httpRotationAttestationSource,
  keysFromMnemonic,
  PARENT_NAME,
  resolveStealthMeta,
  rotationAttestationLookup,
  rotationClaimTypedData,
  rotationSignal,
  sessionSignal,
  signRegisterKeysOnBehalf,
  signSessionLookup,
  TEXT_KEY_STEALTH,
  type RegistryReader,
} from "@soapay/sdk";
import { baseClient, CHAIN_ID, ensClient } from "./claim.js";
import { c, LOCAL_FILE, readLocalRaw, short, writeLocalRaw } from "./local.js";
import { API_URL, DEFAULT_VICTIM, DRY, stolenPhrase } from "./recovery.js";
import {
  capturedSessionId,
  explainRefusal,
  honestyLine,
  otherPersonSessionResult,
  parseArgs,
  readbackVerdict,
  shortSession,
  USAGE,
  type ProofMode,
} from "./worldid-attack.js";

const ATTESTER = process.env.SOAPAY_ATTESTER ?? "0x62377F8ad1151f5b1917708FFD67220F37dF2574";

type ApiRes = { status: number; text: string; body: any };

async function api(path: string, body?: unknown): Promise<ApiRes> {
  const res = await fetch(
    `${API_URL}${path}`,
    body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  );
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // not JSON; kept verbatim in `text`
  }
  return { status: res.status, text, body: parsed };
}

// ---------------------------------------------------------------------------------------------
// The victim's captured linking proof (for --replay), kept in the git-ignored demo file

type CapturedLink = { label: string; sessionId: string; result: Record<string, unknown>; at: number };

function capturedLinks(): CapturedLink[] {
  const l = readLocalRaw().worldIdLinks;
  return Array.isArray(l) ? (l as CapturedLink[]) : [];
}

function saveCapturedLink(link: CapturedLink): void {
  const others = capturedLinks().filter((l) => l.label !== link.label);
  writeLocalRaw({ ...readLocalRaw(), worldIdLinks: [...others, link] });
}

// ---------------------------------------------------------------------------------------------
// IDKit in Node (setup only): its WASM loader fetches a file: URL, which Node's fetch doesn't serve.

async function loadIdkit() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const u = input instanceof URL ? input : typeof input === "string" && input.startsWith("file:") ? new URL(input) : null;
    if (u?.protocol === "file:") return new Response(readFileSync(fileURLToPath(u)), { headers: { "content-type": "application/wasm" } });
    return realFetch(input, init);
  }) as typeof fetch;
  return import("@worldcoin/idkit-core");
}

// ---------------------------------------------------------------------------------------------
// --setup: link the victim's name to the presenter's real World ID, once, in rehearsal

async function setup(label: string): Promise<void> {
  const name = `${label}.${PARENT_NAME}`;
  const victim = keysFromMnemonic(stolenPhrase(label));
  console.log(c.bold(`Setup: link ${name} to a real World ID (Proof of Human session)`) + c.dim(`  API ${API_URL}`));
  console.log(c.dim("  This plays the VICTIM, once, in rehearsal: scan with YOUR World App. On stage the thief never gets this."));
  const rec = await api(`/names/${label}`);
  if (rec.status !== 200) throw new Error(`${name} isn't claimed on this API (${rec.status}); run pnpm demo:setup-recovery ${label} first`);
  if (rec.body.registrant?.toLowerCase() !== victim.registrantAddress.toLowerCase()) throw new Error(`${name}'s registrant isn't the key behind the stored phrase`);
  if (rec.body.worldIdSession) {
    const captured = capturedLinks().some((l) => l.label === label);
    console.log(`  ${c.green("ok")}  already linked (${new Date(rec.body.worldIdSession.attachedAt * 1000).toLocaleString()}); a name keeps its first session.`);
    console.log(c.dim(captured ? "  The linking proof is saved, so --replay works." : "  No linking proof was saved here, so --replay isn't available; the default attack works."));
    return;
  }
  if (DRY) {
    console.log(c.dim("  DEMO_DRY: would request a World ID session, show its QR, and POST /names/:label/session"));
    return;
  }

  const ctx = await api("/worldid/rp-context", { kind: "session", bind: sessionSignal(label, victim.registrantAddress) });
  if (ctx.status !== 200) throw new Error(`rp-context refused: ${ctx.text}`);
  const { IDKit, CredentialRequest } = await loadIdkit();
  const request = await IDKit.createSession({ app_id: ctx.body.app_id, rp_context: ctx.body.rp_context, environment: ctx.body.environment }).constraints(
    CredentialRequest("proof_of_human", {}),
  );
  const QRCode = (await import("qrcode")).default;
  console.log(await QRCode.toString(request.connectorURI, { type: "terminal", small: true }));
  console.log(`  Scan with the World App (Proof of Human), or open: ${request.connectorURI}`);
  const done = await request.pollUntilCompletion({ timeout: 300_000 });
  if (!done.success) throw new Error(`World ID didn't complete: ${done.error}`);
  const result = done.result as unknown as Record<string, unknown>;
  const sessionId = capturedSessionId(result);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1_800);
  const signature = await privateKeyToAccount(victim.registrantKey).signTypedData(attachSessionTypedData({ label, sessionId, deadline, chainId: CHAIN_ID }));
  const res = await api(`/names/${label}/session`, { deadline: deadline.toString(), signature, worldIdResult: result });
  if (res.status !== 201) throw new Error(`POST /names/${label}/session → ${res.status} ${res.text}`);
  saveCapturedLink({ label, sessionId, result, at: Date.now() });
  const from = new Date(res.body.rotationAllowedFrom * 1000);
  console.log(`  ${c.green("ok")}  ${name} is linked to your World ID (${shortSession(sessionId)}), held by Soapay's API.`);
  console.log(`  It can back a key change from ${from.toLocaleString()}${res.body.rotationAllowedFrom <= Math.floor(Date.now() / 1000) ? " (now: this API has no attach wait)" : ""}.`);
  console.log(c.dim(`  The linking proof (already spent) is saved in ${LOCAL_FILE} for --replay. Never printed.`));
  console.log(c.dim(`  Make sure ${name} is in the company app's Recipients (resolved and pinned) before the demo.`));
}

// ---------------------------------------------------------------------------------------------
// The attack

async function resolved(name: string): Promise<string | null> {
  try {
    return (await resolveStealthMeta({ ensClient, baseClient: baseClient as unknown as RegistryReader, name })).metaAddressURI;
  } catch {
    return null;
  }
}

async function attack(label: string, mode: ProofMode): Promise<number> {
  const name = `${label}.${PARENT_NAME}`;
  const step = (n: number, s: string) => console.log(`\n${c.bold(`${n}. ${s}`)}`);
  console.log(c.bold(`Soapay failure path: a thief with ${name}'s recovery phrase tries to move the name, confirming with World ID`) + c.dim(`  API ${API_URL}${DRY ? "  (DEMO_DRY: nothing is sent)" : ""}`));
  console.log(c.dim(`Honest note: ${honestyLine(mode)}`));

  // 1. The stolen phrase
  step(1, `The thief has ${name}'s recovery phrase`);
  const victim = keysFromMnemonic(stolenPhrase(label));
  const rec = await api(`/names/${label}`);
  if (rec.status !== 200) throw new Error(`${name} isn't claimed on this API (${rec.status})`);
  if (rec.body.registrant?.toLowerCase() !== victim.registrantAddress.toLowerCase()) throw new Error(`${name}'s registrant isn't the key behind this phrase`);
  const beforeMeta = await resolved(name);
  if (!beforeMeta) throw new Error(`${name} doesn't resolve cleanly right now (ENS and ERC-6538 disagree?); try again in a few seconds`);
  const attestationsBefore = ((await api(`/names/${label}/attestations`)).body?.items ?? []) as { newMeta: string }[];
  console.log(`  phrase            ${c.dim(`loaded from the git-ignored demo file (never printed)`)}`);
  console.log(`  registrant        ${victim.registrantAddress}  ${c.dim("(= the name's registrant: the phrase controls the ENS record)")}`);
  console.log(`  name points at    ${short(beforeMeta)}  ${c.dim(beforeMeta.toLowerCase() === victim.metaAddressURI.toLowerCase() ? "(the victim's keys)" : "(not the victim's generation-0 keys)")}`);
  let victimSession: string | undefined;
  if (rec.body.worldIdSession) {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    const signature = await signSessionLookup({ label, deadline, chainId: CHAIN_ID, registrantKey: victim.registrantKey });
    const look = await api(`/names/${label}/session/lookup`, { deadline: deadline.toString(), signature });
    victimSession = look.status === 200 ? (look.body.sessionId as string) : undefined;
    console.log(
      `  World ID link     linked ${new Date(rec.body.worldIdSession.attachedAt * 1000).toLocaleString()}${victimSession ? `, session ${shortSession(victimSession)}` : ""}  ${c.dim("(held by Soapay's API, not on-chain; the stolen key can read the id, not prove it)")}`,
    );
  } else {
    console.log(`  World ID link     ${c.cyan("none")}  ${c.dim(`(for the session_mismatch beat, link it once in rehearsal: pnpm demo:attacker-worldid ${label} --setup)`)}`);
  }

  // 2. The rotation, signed with the stolen key
  step(2, "The thief signs a rotation to keys they control");
  const thiefMeta = keysFromMnemonic(generateMnemonic()).metaAddressURI;
  const oldMeta = rec.body.metaAddress as string;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const registrantSig = await privateKeyToAccount(victim.registrantKey).signTypedData(rotationClaimTypedData({ label, oldMeta, newMeta: thiefMeta, deadline, chainId: CHAIN_ID }));
  const nonce = await getRegistryNonce(baseClient as unknown as RegistryReader, victim.registrantAddress);
  const registerSig = await signRegisterKeysOnBehalf({ registrantKey: victim.registrantKey, metaAddressURI: thiefMeta, chainId: CHAIN_ID, nonce });
  console.log(`  thief's keys      ${short(thiefMeta)}  ${c.dim("(a fresh phrase, in memory only)")}`);
  console.log(`  signed            RotationClaim(${label}: current keys → thief's keys) and the ERC-6538 update, both with the stolen registrant key ${c.green("✓")}`);

  // 3. The World ID proof that isn't the victim's
  let proof: Record<string, unknown>;
  if (mode === "replay") {
    step(3, `The thief presents a World ID proof: ${label}'s own, captured and replayed`);
    const link = capturedLinks().find((l) => l.label === label);
    if (!link) throw new Error(`no captured proof for ${label}: run pnpm demo:attacker-worldid ${label} --setup in rehearsal (it saves the linking proof)`);
    proof = link.result;
    console.log(`  presents          the proof ${label} made when linking World ID (session ${shortSession(link.sessionId)}, already used once) ${c.dim("[REAL proof, replayed]")}`);
  } else {
    step(3, `The thief confirms with their own World ID, not ${label}'s`);
    let rpNonce = "0x00";
    let environment = "production";
    if (!DRY) {
      const cfg = await api("/worldid/config");
      environment = cfg.body?.environment ?? environment;
      const ctx = await api("/worldid/rp-context", { kind: "session", bind: rotationSignal(label, thiefMeta, deadline) });
      if (ctx.status === 200) rpNonce = ctx.body.rp_context.nonce;
      console.log(`  asks Soapay       for a World ID request bound to this exact change ${ctx.status === 200 ? c.green("✓") : c.dim(`(refused: ${ctx.status})`)}`);
    }
    proof = otherPersonSessionResult({ nonce: rpNonce, environment, ...(victimSession ? { victimSessionId: victimSession } : {}) });
    console.log(
      `  presents          a session proof for ${shortSession(proof.session_id as string)}${victimSession ? `, NOT the linked ${shortSession(victimSession)}` : ""} ${c.dim("[SIMULATED: no second human here; see the honest note]")}`,
    );
  }

  // 4. The API's answer
  step(4, "Soapay API answers");
  const body = { newMeta: thiefMeta, deadline: deadline.toString(), registrantSig, registerSig, worldIdResult: proof };
  if (DRY) {
    console.log(c.dim(`  DEMO_DRY: would POST /names/${label}/rotation (signatures and proof omitted here)`));
    return 0;
  }
  const res = await api(`/names/${label}/rotation`, body);
  console.log(`  POST /names/${label}/rotation → HTTP ${res.status}`);
  console.log(`  ${res.text.trim()}`);
  if (res.status >= 200 && res.status < 300) {
    console.error(c.bold("  The API attested a rotation for a proof that isn't the victim's. This must never happen."));
    return 1;
  }
  const code = (res.body?.error?.code as string | undefined) ?? `http_${res.status}`;
  console.log(`  ${c.bold("In plain words:")} ${explainRefusal(code)}`);

  // 5. Read back
  step(5, "Read back: did anything change?");
  const [ensMeta, after, feed] = await Promise.all([
    ensClient.getEnsText({ name, key: TEXT_KEY_STEALTH }).catch(() => null),
    resolved(name),
    api(`/names/${label}/attestations`),
  ]);
  const lookup = rotationAttestationLookup({ attester: ATTESTER, chainId: CHAIN_ID, source: httpRotationAttestationSource(API_URL) });
  const decision = after
    ? await checkMetaPin({ identifier: name, pin: { metaAddressURI: beforeMeta, pinnedAt: Date.now(), history: [] }, resolvedMeta: after, lookup })
    : { state: "unresolved" };
  const verdict = readbackVerdict({
    name,
    ensMeta,
    beforeMeta,
    attackerMeta: thiefMeta,
    attestations: (feed.body?.items ?? []) as { newMeta: string }[],
    attestationsBefore: attestationsBefore.length,
    pinState: decision.state,
  });
  for (const l of verdict.lines) console.log(`  ${l}`);
  console.log(verdict.unchanged ? `  ${c.green("✓")} ${c.bold(`name unchanged: ${short(ensMeta ?? beforeMeta)}`)}` : c.bold(`  name CHANGED: ${short(ensMeta ?? "?")}`));

  // 6. The company app
  step(6, "Now show it in the company app");
  console.log(`  Recipients (or Pay run) → ${c.bold("Resolve names")} → ${name}: still ${c.green("Verified")}. The pin didn't move.`);
  console.log(c.dim(`  Contrast: pnpm demo:attacker ${label} rewrites the ENS record directly with the same stolen key → "Blocked · record changed".`));
  return verdict.unchanged ? 0 : 1;
}

// ---------------------------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2), DEFAULT_VICTIM);
try {
  if (args.kind === "help") console.log(USAGE);
  else if (args.kind === "error") {
    console.error(`demo-attacker-worldid: ${args.message}\n${USAGE}`);
    process.exitCode = 2;
  } else if (args.kind === "setup") await setup(args.label);
  else process.exitCode = await attack(args.label, args.mode);
} catch (e) {
  console.error(`demo-attacker-worldid: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
  process.exitCode = 1;
}
