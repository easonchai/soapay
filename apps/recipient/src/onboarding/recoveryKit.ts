/**
 * The recovery kit (D-44): "save, don't memorise". A small text file with the recovery phrase and plain
 * restore instructions, so the user can keep it in a password manager or a file instead of copying 12 words
 * onto paper and passing a quiz.
 *
 * The kit holds ONLY the phrase, the pay name (when known) and the creation date. No derived key, address or
 * meta-address goes in it: the phrase alone recovers everything (PRD "Key handling / Recovery").
 */
import { REGISTRANT_KEY_PATH, SPENDING_KEY_PATH, VIEWING_KEY_PATH, validateMnemonic } from "@soapay/sdk";

export type RecoveryKitInput = {
  mnemonic: string;
  /** Full pay name, e.g. "alex.soapay.eth", when an invite already reserved it. */
  name?: string | undefined;
  createdAt: Date;
};

const PHRASE_HEADING = "RECOVERY PHRASE";

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** `soapay-recovery-kit-<label or date>.txt`, filesystem-safe. */
export function recoveryKitFilename(name: string | undefined, createdAt: Date): string {
  const label = name?.split(".")[0]?.replace(/[^a-z0-9-]/gi, "").toLowerCase();
  return `soapay-recovery-kit-${label || isoDate(createdAt)}.txt`;
}

export function recoveryKitText({ mnemonic, name, createdAt }: RecoveryKitInput): string {
  const phrase = mnemonic.trim().split(/\s+/).join(" ");
  const count = phrase.split(" ").length;
  return [
    "SOAPAY RECOVERY KIT",
    "===================",
    "",
    "This is the one key to every payment you receive with Soapay, even if Soapay disappears.",
    "Keep this file somewhere safe and private: your password manager, iCloud Keychain or Google",
    "Password Manager notes, or a file only you can open. Anyone who has it can take your funds.",
    "Losing the seed loses the funds: nobody can reset it, not Soapay and not your employer.",
    "",
    ...(name ? [`Pay name: ${name}`] : []),
    `Created:  ${isoDate(createdAt)}`,
    "",
    `${PHRASE_HEADING} (${count} words):`,
    phrase,
    "",
    "HOW TO RESTORE",
    "--------------",
    "1. Open the Soapay app and choose \"Restore from recovery phrase\".",
    "2. Open this file with \"Open recovery kit\", or paste the words above.",
    "3. Lock the new device with a passkey. Every payment is found again from the chain.",
    "",
    "WITHOUT SOAPAY",
    "--------------",
    "The phrase is a standard BIP-39 mnemonic (English wordlist, no extra passphrase). The open-source",
    "@soapay/sdk derives your keys from it with keysFromMnemonic(phrase), using these BIP-32 paths:",
    `  spending key    ${SPENDING_KEY_PATH}`,
    `  viewing key     ${VIEWING_KEY_PATH}`,
    `  registrant key  ${REGISTRANT_KEY_PATH}`,
    "Any ERC-5564 scanner with the spending and viewing keys can find and spend your payments.",
    "",
    "Never type these words into a website you didn't open yourself, and never share them.",
    "",
  ].join("\n");
}

/**
 * The recovery phrase in a kit file (or any text with the phrase on one line). Returns null when no line
 * holds a valid BIP-39 phrase.
 */
export function parseRecoveryKit(text: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const ws = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (![12, 15, 18, 21, 24].includes(ws.length) || !ws.every((w) => /^[a-z]+$/.test(w))) continue;
    const m = ws.join(" ");
    if (validateMnemonic(m)) return m;
  }
  return null;
}

/** Hands `text` to the browser as a file download (Blob + object URL; no network, no CSP change). */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the browser has picked the blob up.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** `File.text()`, with a FileReader fallback for older engines. */
export function readFileText(file: Blob): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error ?? new Error("Couldn't read the file."));
    r.readAsText(file);
  });
}
