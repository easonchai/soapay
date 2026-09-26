// Minimal CSV reader for recipient lists: a header row, comma-separated, optional double quotes,
// `#` comment lines and blank lines ignored.
import { UsageError } from "./args.js";

export type CsvRow = { line: number; values: Record<string, string> };

function splitRow(line: string, lineNo: number): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (quoted) throw new UsageError(`CSV line ${lineNo}: unterminated quote`);
  out.push(cur.trim());
  return out;
}

export function parseCsv(text: string, required: readonly string[]): CsvRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  let header: string[] | undefined;
  const rows: CsvRow[] = [];
  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const cells = splitRow(line, lineNo);
    if (!header) {
      header = cells.map((c) => c.toLowerCase());
      for (const r of required) if (!header.includes(r)) throw new UsageError(`CSV header must include "${r}" (got: ${header.join(",")})`);
      return;
    }
    if (cells.length !== header.length) throw new UsageError(`CSV line ${lineNo}: expected ${header.length} columns, got ${cells.length}`);
    const values: Record<string, string> = {};
    header.forEach((h, j) => (values[h] = cells[j] ?? ""));
    rows.push({ line: lineNo, values });
  });
  if (!header) throw new UsageError("CSV is empty");
  if (rows.length === 0) throw new UsageError("CSV has no rows");
  return rows;
}
