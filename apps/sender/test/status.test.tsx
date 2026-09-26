// The two states the World ID failure path lands on (docs/worldid.md, "Failure path"):
// a refused World ID rotation leaves the pin alone (Verified); a record rewritten with the stolen key
// and no attestation is Blocked, with an explainer on hover.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Address } from "viem";
import { BLOCKED_EXPLAINER, RecordStatus, VERIFIED_EXPLAINER } from "../src/ui/status.js";
import type { Employee } from "../src/lib/roster.js";

afterEach(cleanup);

const REG = "0x00000000000000000000000000000000000000aa" as Address;
const emp = (extra: Partial<Employee> = {}): Employee => ({
  id: "sam",
  ensName: "sam-demo.soapay.eth",
  amount: 1_000_000n,
  pin: { metaAddressURI: `st:eth:0x${"02".repeat(66)}`, registrant: REG, pinnedAt: 1 },
  pinHistory: [],
  carry: 0n,
  active: true,
  ...extra,
});

describe("RecordStatus", () => {
  it("Verified when the name still resolves to the pin (e.g. after a refused World ID rotation)", () => {
    render(<RecordStatus e={emp()} payability={{ payable: true }} lines={2} />);
    const el = screen.getByTestId("status-verified");
    expect(el.textContent).toContain("Verified · 2 fresh addresses");
    expect(el.getAttribute("title")).toBe(VERIFIED_EXPLAINER);
    expect(screen.queryByTestId("status-blocked")).toBeNull();
  });

  it("Blocked · record changed, explained as a change without a World ID proof from the linked person", () => {
    const e = emp({
      pendingChange: {
        metaAddressURI: `st:eth:0x${"03".repeat(66)}`,
        registrant: REG,
        detectedAt: 2,
        attestation: { state: "missing", reason: "Changed without a World ID proof from the linked person (Soapay has no attestation for this change)" },
      },
    });
    render(<RecordStatus e={e} payability={{ payable: false, reason: "changed", message: "changed" }} />);
    const el = screen.getByTestId("status-blocked");
    expect(el.textContent).toBe("Blocked · record changed");
    expect(el.getAttribute("title")).toBe(BLOCKED_EXPLAINER);
    expect(BLOCKED_EXPLAINER).toMatch(/^Record changed without a World ID proof from the linked person/);
    // Precise about what's where: the record is on-chain, the attestation is Soapay's.
    expect(BLOCKED_EXPLAINER).toContain("ENS record");
    expect(BLOCKED_EXPLAINER).toContain("Soapay has no signed attestation");
  });
});
