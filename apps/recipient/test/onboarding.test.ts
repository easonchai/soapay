import { describe, expect, it } from "vitest";
import { initialState, pickChallenge, progressOf, reduce, resumeState, type OnboardingEvent, type OnboardingState } from "../src/onboarding/machine.js";

const M = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const run = (events: OnboardingEvent[], from: OnboardingState = initialState) => events.reduce(reduce, from);

describe("onboarding machine", () => {
  it("create → backup → confirm → passphrase → register → name → recovery → share → done", () => {
    let s = run([{ type: "CREATE", mnemonic: M }, { type: "BACKED_UP", challenge: [0, 5, 11] }]);
    expect(s.step).toBe("confirm");
    s = reduce(s, { type: "CONFIRM", answers: ["legal", "sausage", "yellow"] });
    expect(s).toEqual({ step: "passphrase", mnemonic: M, origin: "create" });
    s = run([{ type: "VAULT_CREATED" }, { type: "REGISTERED" }], s);
    expect(s.step).toBe("name");
    // The World ID session signal binds the label, so recovery comes after choosing it.
    s = reduce(s, { type: "NAME_CHOSEN", label: "alex" });
    expect(s).toEqual({ step: "recovery", label: "alex" });
    s = run([{ type: "NAMED" }, { type: "FINISH" }], s);
    expect(s.step).toBe("done");
  });

  it("World ID recovery is optional: skipping the name skips recovery too, and recovery can go back", () => {
    expect(reduce({ step: "name" }, { type: "SKIP_NAME" })).toEqual({ step: "share" });
    expect(reduce({ step: "recovery", label: "alex" }, { type: "BACK" })).toEqual({ step: "name" });
  });

  it("does not require World ID before registering", () => {
    expect(reduce({ step: "passphrase", mnemonic: M, origin: "create" }, { type: "VAULT_CREATED" })).toEqual({ step: "register" });
  });

  it("rejects wrong confirmation words (normalised) and counts attempts", () => {
    const c = run([{ type: "CREATE", mnemonic: M }, { type: "BACKED_UP", challenge: [0, 1] }]);
    const bad = reduce(c, { type: "CONFIRM", answers: ["legal", "loser"] });
    expect(bad.step).toBe("confirm");
    if (bad.step === "confirm") expect(bad.attempts).toBe(1);
    expect(reduce(c, { type: "CONFIRM", answers: ["  LEGAL ", "Winner"] }).step).toBe("passphrase");
  });

  it("restore validates the phrase", () => {
    const r = run([{ type: "RESTORE" }]);
    expect(reduce(r, { type: "RESTORE_SUBMIT", mnemonic: "x", valid: false })).toMatchObject({ step: "restore", error: expect.any(String) });
    expect(reduce(r, { type: "RESTORE_SUBMIT", mnemonic: M, valid: true })).toEqual({ step: "passphrase", mnemonic: M, origin: "restore" });
  });

  it("leaving backup discards the seed", () => {
    expect(reduce({ step: "backup", mnemonic: M }, { type: "BACK" })).toEqual({ step: "welcome" });
  });

  it("ignores events that don't belong to the current step", () => {
    const s: OnboardingState = { step: "register" };
    expect(reduce(s, { type: "NAMED" })).toBe(s);
  });

  it("resumes from what the vault records", () => {
    expect(resumeState({})).toEqual({ step: "register" });
    const reg = { registration: { txHash: "0x1" as const, status: "success", chainId: 1, at: 0 } };
    expect(resumeState(reg)).toEqual({ step: "name" });
    expect(resumeState({ ...reg, nameSkipped: true })).toEqual({ step: "share" });
    expect(resumeState({ ...reg, name: { label: "a", name: "a.soapay.eth", at: 0 } })).toEqual({ step: "share" });
    expect(resumeState({ onboardedAt: 1 })).toEqual({ step: "done" });
  });

  it("picks distinct sorted challenge positions and reports progress", () => {
    let i = 0;
    const seq = [0.9, 0.1, 0.1, 0.5];
    const c = pickChallenge(12, 3, () => seq[i++ % seq.length]!);
    expect(c).toEqual([1, 6, 10]);
    expect(progressOf({ step: "recovery", label: "a" })).toEqual([6, 7]);
  });
});
