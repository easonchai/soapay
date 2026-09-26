// The demo's secrets file: recovery phrases for the demo recipients and the demo agent.
// It lives at scripts/.demo-recipients.local.json (git-ignored, mode 0600) and is never printed.
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateMnemonic, keysFromMnemonic } from "@soapay/sdk";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const LOCAL_FILE = process.env.SOAPAY_DEMO_FILE ?? resolve(REPO, "scripts/.demo-recipients.local.json");

/** Dividend holders with soapay names (claimed once by setup-recipients.ts). */
export const HOLDER_LABELS = ["dividend-ana", "dividend-ben", "dividend-cleo"] as const;
/** The agent's label; claimed live by agent-gets-paid.ts through the MCP server. */
export const AGENT_LABEL = "invoice-agent";

export type DemoLocal = {
  holders: { label: string; phrase: string }[];
  /** A holder paid by raw meta-address (no name, no registration). */
  rawHolder: { id: string; phrase: string };
  agent: { label: string; phrase: string };
};

export function loadOrCreateLocal(): DemoLocal {
  if (existsSync(LOCAL_FILE)) return JSON.parse(readFileSync(LOCAL_FILE, "utf8")) as DemoLocal;
  const local: DemoLocal = {
    holders: HOLDER_LABELS.map((label) => ({ label, phrase: generateMnemonic() })),
    rawHolder: { id: "dana", phrase: generateMnemonic() },
    agent: { label: AGENT_LABEL, phrase: generateMnemonic() },
  };
  writeFileSync(LOCAL_FILE, `${JSON.stringify(local, null, 2)}\n`, { mode: 0o600 });
  chmodSync(LOCAL_FILE, 0o600);
  return local;
}

export const metaOf = (phrase: string) => keysFromMnemonic(phrase).metaAddressURI;

/** Shortens addresses and meta-addresses for display. */
export const short = (s: string) => {
  const head = s.startsWith("st:eth:") ? 17 : 10;
  return s.length > head + 10 ? `${s.slice(0, head)}…${s.slice(-6)}` : s;
};

export const c = {
  dim: (s: string) => (process.stdout.isTTY || process.env.FORCE_COLOR ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (process.stdout.isTTY || process.env.FORCE_COLOR ? `\x1b[1m${s}\x1b[0m` : s),
  green: (s: string) => (process.stdout.isTTY || process.env.FORCE_COLOR ? `\x1b[32m${s}\x1b[0m` : s),
  cyan: (s: string) => (process.stdout.isTTY || process.env.FORCE_COLOR ? `\x1b[36m${s}\x1b[0m` : s),
};
