// Roster CSV import: `name,amount[,label]`, header optional. Amounts parse exactly
// (see amount.ts); nothing is resolved here, enrollment does that.
import Papa from "papaparse";
import { normalize } from "viem/ens";
import { tryParseUsdc } from "./amount.js";

export type CsvRow = {
  /** 1-based line in the file, for error messages. */
  line: number;
  ensName: string;
  amount: bigint;
  label?: string;
};

export type CsvIssue = { line: number; message: string };

export type CsvImport = { rows: CsvRow[]; issues: CsvIssue[] };

const NAME_HEADERS = new Set(["name", "ens", "ens name", "ensname", "employee"]);
const AMOUNT_HEADERS = new Set(["amount", "salary", "usdc", "amount (usdc)"]);

/** Normalizes an ENS name (UTS-46). Returns null when it is not a usable ENS name. */
export function normalizeEnsName(input: string): string | null {
  const t = input.trim();
  if (!t || !t.includes(".") || t.startsWith(".") || t.endsWith(".")) return null;
  try {
    return normalize(t);
  } catch {
    return null;
  }
}

/**
 * Why `input` can't be a payee, or null when it is not an ENS name for some other reason.
 * Owner decision 2026-09-26 (roster only): every payee is a pinned, verified ENS name, so the raw
 * `st:eth:` meta-addresses and plain addresses CK's per-run paste list accepted are refused.
 */
export function payeeRejection(input: string): string | null {
  const t = input.trim();
  if (/^st:/i.test(t)) {
    return "Stealth meta-addresses can't be paid directly. Every payee is a pinned, verified ENS name: invite them (Invite employee) or ask for their soapay.eth name.";
  }
  if (/^0x[0-9a-f]*$/i.test(t)) {
    return "Plain addresses can't be paid. Every payee is a pinned, verified ENS name: invite them (Invite employee) or ask for their soapay.eth name.";
  }
  return null;
}

/** Error text for a roster name that isn't usable. */
export function notAPayeeName(input: string): string {
  return payeeRejection(input) ?? `"${input.trim() || "(empty)"}" is not an ENS name, e.g. alice.soapay.eth`;
}

export function parseRosterCsv(text: string): CsvImport {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  const rows: CsvRow[] = [];
  const issues: CsvIssue[] = [];
  const seen = new Map<string, number>();

  let data = parsed.data;
  let nameCol = 0;
  let amountCol = 1;
  let labelCol = 2;
  const first = data[0]?.map((c) => c.trim().toLowerCase());
  if (first && first.some((c) => NAME_HEADERS.has(c)) && first.some((c) => AMOUNT_HEADERS.has(c))) {
    nameCol = first.findIndex((c) => NAME_HEADERS.has(c));
    amountCol = first.findIndex((c) => AMOUNT_HEADERS.has(c));
    labelCol = first.findIndex((c) => c === "label" || c === "display name" || c === "note");
    data = data.slice(1);
  }
  const offset = parsed.data.length - data.length;

  data.forEach((cells, i) => {
    const line = i + 1 + offset;
    const rawName = cells[nameCol]?.trim() ?? "";
    const rawAmount = cells[amountCol]?.trim() ?? "";
    if (!rawName && !rawAmount) return;
    const ensName = normalizeEnsName(rawName);
    if (!ensName) {
      issues.push({ line, message: notAPayeeName(rawName) });
      return;
    }
    const amount = tryParseUsdc(rawAmount);
    if (!amount.ok) {
      issues.push({ line, message: `${ensName}: ${amount.error}` });
      return;
    }
    if (amount.value === 0n) {
      issues.push({ line, message: `${ensName}: amount must be more than 0` });
      return;
    }
    const dup = seen.get(ensName);
    if (dup !== undefined) {
      issues.push({ line, message: `${ensName} already appears on line ${dup}` });
      return;
    }
    seen.set(ensName, line);
    const label = labelCol >= 0 ? cells[labelCol]?.trim() : undefined;
    rows.push({ line, ensName, amount: amount.value, ...(label ? { label } : {}) });
  });

  for (const e of parsed.errors) {
    if (e.type === "Delimiter") continue; // single-column files are reported per row instead
    issues.push({ line: (e.row ?? 0) + 1, message: e.message });
  }
  return { rows, issues };
}

/** Template the Roster screen offers for download. */
export const CSV_TEMPLATE = "name,amount,label\nalice.soapay.eth,5000,Alice (Design)\nbob.soapay.eth,4250.50,Bob\n";
