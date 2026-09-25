import { describe, expect, it, vi } from "vitest";
import { NameNotFound } from "@soapay/sdk";
import {
  enrollEmployee,
  EnrollmentError,
  payability,
  reapproveChange,
  ReapprovalError,
  recordChanges,
  verifyRoster,
  type Employee,
} from "../src/lib/roster.js";
import { createMockResolver, memoryRotationStore } from "../src/lib/resolver.js";
import type { WorldIdLookup } from "../src/lib/worldid.js";

const unknownWorldId: WorldIdLookup = async () => ({ state: "unknown" });

async function setup() {
  const rotations = memoryRotationStore();
  const resolve = createMockResolver(rotations, 0);
  const alice = await enrollEmployee(resolve, { ensName: "alice.soapay.eth", amount: 5_000_000_000n }, [], 1);
  const bob = await enrollEmployee(resolve, { ensName: "bob.soapay.eth", amount: 4_000_000_000n, label: "Bob" }, [alice], 1);
  return { rotations, resolve, roster: [alice, bob] as Employee[] };
}

describe("enrollment pins the meta-address once", () => {
  it("pins the resolved meta-address and records history", async () => {
    const { roster } = await setup();
    expect(roster[0]!.pin.metaAddressURI).toMatch(/^st:eth:0x[0-9a-f]{132}$/);
    expect(roster[0]!.pinHistory).toHaveLength(1);
    expect(roster[0]!.pinHistory[0]!.reason).toBe("enrolled");
    expect(roster[1]!.label).toBe("Bob");
  });

  it("rejects duplicates and zero amounts", async () => {
    const { resolve, roster } = await setup();
    await expect(enrollEmployee(resolve, { ensName: "alice.soapay.eth", amount: 1n }, roster)).rejects.toThrow(EnrollmentError);
    await expect(enrollEmployee(resolve, { ensName: "carol.soapay.eth", amount: 0n }, roster)).rejects.toThrow(/more than 0/);
  });

  it("surfaces resolution errors", async () => {
    const { resolve, roster } = await setup();
    await expect(enrollEmployee(resolve, { ensName: "missing.soapay.eth", amount: 1n }, roster)).rejects.toThrow(NameNotFound);
  });
});

describe("pin-change blocking", () => {
  it("unchanged names are payable after a fresh check", async () => {
    const { resolve, roster } = await setup();
    const checks = await verifyRoster(resolve, roster);
    for (const e of roster) expect(payability(e, checks.get(e.id))).toEqual({ payable: true });
  });

  it("an unchecked employee is never payable", async () => {
    const { roster } = await setup();
    expect(payability(roster[0]!, undefined)).toMatchObject({ payable: false, reason: "unchecked" });
  });

  it("a changed meta-address blocks only that employee, and persists until re-approval", async () => {
    const { resolve, rotations, roster } = await setup();
    rotations.bump("alice.soapay.eth"); // alice's name now resolves to a different meta-address
    const checks = await verifyRoster(resolve, roster);
    expect(checks.get(roster[0]!.id)!.status).toBe("changed");
    expect(payability(roster[0]!, checks.get(roster[0]!.id))).toMatchObject({ payable: false, reason: "changed" });
    expect(payability(roster[1]!, checks.get(roster[1]!.id))).toEqual({ payable: true });

    const updated = await recordChanges(roster, checks, unknownWorldId, 2);
    const alice = updated[0]!;
    expect(alice.pendingChange?.metaAddressURI).toBe((checks.get(alice.id) as { resolved: { metaAddressURI: string } }).resolved.metaAddressURI);
    // The pin itself is untouched: nothing pays the new address until the employer approves.
    expect(alice.pin.metaAddressURI).toBe(roster[0]!.pin.metaAddressURI);

    // Still blocked even if a later check came back "ok" (e.g. a stale/forged check).
    expect(payability(alice, { status: "ok", resolved: { metaAddressURI: alice.pin.metaAddressURI, registrant: alice.pin.registrant }, checkedAt: 3 })).toMatchObject({
      payable: false,
      reason: "changed",
    });

    // Explicit re-approval pins exactly the reviewed value and unblocks.
    const approved = await reapproveChange(resolve, alice, 4);
    expect(approved.pendingChange).toBeUndefined();
    expect(approved.pin.metaAddressURI).toBe(alice.pendingChange!.metaAddressURI);
    expect(approved.pinHistory.at(-1)).toMatchObject({ reason: "re-approved", at: 4 });
    const recheck = await verifyRoster(resolve, [approved]);
    expect(payability(approved, recheck.get(approved.id))).toEqual({ payable: true });
  });

  it("refuses a re-approval if the name moved again after review", async () => {
    const { resolve, rotations, roster } = await setup();
    rotations.bump("alice.soapay.eth");
    const [alice] = await recordChanges(roster, await verifyRoster(resolve, roster), unknownWorldId);
    rotations.bump("alice.soapay.eth");
    await expect(reapproveChange(resolve, alice!)).rejects.toThrow(ReapprovalError);
  });

  it("clears the warning without changing the pin if the name points back", async () => {
    const { resolve, roster } = await setup();
    const fake = { ...roster[0]!, pendingChange: { metaAddressURI: roster[1]!.pin.metaAddressURI, registrant: roster[1]!.pin.registrant, detectedAt: 1, worldId: { state: "unknown" as const } } };
    const cleared = await reapproveChange(resolve, fake);
    expect(cleared.pendingChange).toBeUndefined();
    expect(cleared.pin).toEqual(roster[0]!.pin);
  });

  it("resolution errors block the employee for the run", async () => {
    const { roster } = await setup();
    const failing = vi.fn().mockRejectedValue(new Error("rpc down"));
    const checks = await verifyRoster(failing, roster);
    expect(payability(roster[0]!, checks.get(roster[0]!.id))).toMatchObject({ payable: false, reason: "error" });
  });

  it("stores the World ID status on the pending change (hook)", async () => {
    const { resolve, rotations, roster } = await setup();
    rotations.bump("bob.soapay.eth");
    const lookup: WorldIdLookup = vi.fn(async () => ({ state: "verified" as const, verifiedAt: 9 }));
    const updated = await recordChanges(roster, await verifyRoster(resolve, roster), lookup);
    expect(updated[1]!.pendingChange?.worldId).toEqual({ state: "verified", verifiedAt: 9 });
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
