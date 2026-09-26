import { describe, expect, it } from "vitest";
import { parseRosterCsv, CSV_TEMPLATE, notAPayeeName, payeeRejection } from "../src/lib/csv.js";

describe("parseRosterCsv", () => {
  it("parses a headed file with labels", () => {
    const r = parseRosterCsv(CSV_TEMPLATE);
    expect(r.issues).toEqual([]);
    expect(r.rows).toEqual([
      { line: 2, ensName: "alice.soapay.eth", amount: 5_000_000_000n, label: "Alice (Design)" },
      { line: 3, ensName: "bob.soapay.eth", amount: 4_250_500_000n, label: "Bob" },
    ]);
  });

  it("roster only: rejects raw meta-addresses and plain addresses with a clear message", () => {
    const meta = `st:eth:0x02${"11".repeat(32)}03${"22".repeat(32)}`;
    const r = parseRosterCsv(`${meta},1000\n0x00000000000000000000000000000000000000aa,500\nalice.soapay.eth,10\n`);
    expect(r.rows.map((x) => x.ensName)).toEqual(["alice.soapay.eth"]);
    expect(r.issues).toHaveLength(2);
    expect(r.issues[0]).toMatchObject({ line: 1, message: expect.stringMatching(/Stealth meta-addresses can't be paid directly.*pinned, verified ENS name/) });
    expect(r.issues[1]).toMatchObject({ line: 2, message: expect.stringMatching(/Plain addresses can't be paid.*pinned, verified ENS name/) });
    expect(payeeRejection("alice.soapay.eth")).toBeNull();
    expect(notAPayeeName("alice")).toMatch(/not an ENS name/);
  });

  it("parses a headerless file and normalizes names", () => {
    const r = parseRosterCsv("Alice.Soapay.ETH,1000\ncarol.soapay.eth,0.5\n");
    expect(r.issues).toEqual([]);
    expect(r.rows.map((x) => [x.ensName, x.amount])).toEqual([
      ["alice.soapay.eth", 1_000_000_000n],
      ["carol.soapay.eth", 500_000n],
    ]);
  });

  it("accepts quoted amounts with thousands separators and reordered columns", () => {
    const r = parseRosterCsv('amount,name\n"12,500.75",dave.soapay.eth\n');
    expect(r.issues).toEqual([]);
    expect(r.rows[0]).toMatchObject({ ensName: "dave.soapay.eth", amount: 12_500_750_000n, line: 2 });
  });

  it("reports bad rows by line and keeps the good ones", () => {
    const r = parseRosterCsv(
      [
        "name,amount",
        "alice.soapay.eth,100",
        "not a name,100",
        "bob.soapay.eth,1.0000001",
        "carol.soapay.eth,0",
        "alice.soapay.eth,200",
        "erin.soapay.eth,-4",
        "frank.soapay.eth,",
      ].join("\n"),
    );
    expect(r.rows.map((x) => x.ensName)).toEqual(["alice.soapay.eth"]);
    expect(r.issues.map((i) => i.line)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(r.issues[0]!.message).toMatch(/not an ENS name/);
    expect(r.issues[1]!.message).toMatch(/6 decimals/);
    expect(r.issues[2]!.message).toMatch(/more than 0/);
    expect(r.issues[3]!.message).toMatch(/already appears on line 2/);
    expect(r.issues[4]!.message).toMatch(/negative/);
    expect(r.issues[5]!.message).toMatch(/Enter an amount/);
  });

  it("handles a BOM, CRLF and blank lines", () => {
    const r = parseRosterCsv("﻿name,amount\r\n\r\nalice.soapay.eth,1\r\n");
    expect(r.issues).toEqual([]);
    expect(r.rows).toHaveLength(1);
  });
});
