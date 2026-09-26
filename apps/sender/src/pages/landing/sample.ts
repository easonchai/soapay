/** Sample data for the landing showcase frames. Static, already formatted; nothing here is read from the app. */

export type RosterStatus = "Verified" | "Re-checking";
export type RosterRow = { name: string; label: string; amount: string; status: RosterStatus };

export type PreviewLine = { address: string; amount: string };

export type RunStatus = "Sent" | "Draft";
export type HistoryRun = { label: string; date: string; lines: number; total: string; status: RunStatus; tx?: string };

const usdc = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** 4200 → "4,200.00" */
export const fmt = (n: number): string => usdc.format(n);

export const COMPANY = "Meridian";
export const WALLET_CHIP = "0x51aD…e0F2 · Base Sepolia";
export const APP_TABS = ["Pay run", "Recipients", "History", "Settings"] as const;

export const ROSTER: RosterRow[] = [
  { name: "alice.soapay.eth", label: "Alice · engineering", amount: fmt(4200), status: "Verified" },
  { name: "bram.soapay.eth", label: "Bram · engineering", amount: fmt(3850), status: "Verified" },
  { name: "chen.soapay.eth", label: "Chen · product", amount: fmt(5100), status: "Verified" },
  { name: "eko.soapay.eth", label: "Eko · design", amount: fmt(4200), status: "Re-checking" },
  { name: "farah.soapay.eth", label: "Farah · operations", amount: fmt(3600), status: "Verified" },
  { name: "gus.soapay.eth", label: "Gus · support", amount: fmt(2950), status: "Verified" },
];

export const RUN = {
  label: "September payroll",
  total: fmt(23_900),
  salaries: 6,
  lines: 51,
  fresh: 51,
  txs: 1,
  chunk: "500",
  gasEth: "0.0021",
} as const;

export const PREVIEW_LINES: PreviewLine[] = [
  { address: "0x7a3F…9c1E", amount: fmt(500) },
  { address: "0x12e9…b04C", amount: fmt(500) },
  { address: "0xf37a…88e1", amount: fmt(500) },
  { address: "0x0c5D…4e77", amount: fmt(500) },
  { address: "0x9bA2…d1F0", amount: fmt(500) },
];

export const HISTORY_STATS = { runs: "12", paid: fmt(286_800), fresh: "612" } as const;

export const RUNS: HistoryRun[] = [
  { label: "Draft · October", date: "—", lines: 51, total: fmt(23_900), status: "Draft" },
  { label: "September payroll", date: "25 Sep 2026", lines: 50, total: fmt(23_900), status: "Sent", tx: "0x2f90…11de" },
  { label: "August payroll", date: "25 Aug 2026", lines: 50, total: fmt(23_900), status: "Sent", tx: "0x8c41…a37b" },
  { label: "Q3 bonus", date: "10 Jul 2026", lines: 24, total: fmt(12_000), status: "Sent", tx: "0xd05e…4b90" },
];
