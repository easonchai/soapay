import { describe, expect, it } from "vitest";
import { initialState, progressOf, reduce, resumeState, type OnboardingEvent, type OnboardingState } from "../src/onboarding/machine.js";

const M = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const run = (events: OnboardingEvent[], from: OnboardingState = initialState) => events.reduce(reduce, from);

describe("onboarding machine", () => {
  it("create → backup (save the kit) → passphrase → register → name → recovery → share → done", () => {
    let s = run([{ type: "CREATE", mnemonic: M }]);
    expect(s).toEqual({ step: "backup", mnemonic: M });
    // D-44: saving the recovery kit goes straight to the Lock step; there is no word quiz.
    s = reduce(s, { type: "BACKED_UP" });
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

  it("back from the Lock step returns to the kit as already saved (the phrase isn't shown twice)", () => {
    const back = reduce({ step: "passphrase", mnemonic: M, origin: "create" }, { type: "BACK" });
    expect(back).toEqual({ step: "backup", mnemonic: M, saved: true });
    expect(reduce(back, { type: "BACKED_UP" })).toEqual({ step: "passphrase", mnemonic: M, origin: "create" });
    expect(reduce(back, { type: "BACK" })).toEqual({ step: "welcome" });
  });

  it("restore validates the phrase", () => {
    const r = run([{ type: "RESTORE" }]);
    expect(reduce(r, { type: "RESTORE_SUBMIT", mnemonic: "x", valid: false })).toMatchObject({ step: "restore", error: expect.any(String) });
    expect(reduce(r, { type: "RESTORE_SUBMIT", mnemonic: M, valid: true })).toEqual({ step: "passphrase", mnemonic: M, origin: "restore" });
  });

  it("leaving backup discards the seed", () => {
    expect(reduce({ step: "backup", mnemonic: M }, { type: "BACK" })).toEqual({ step: "welcome" });
  });

  it("D-45: the wallet-signature step is not reachable from welcome, only from restore", () => {
    expect(reduce(initialState, { type: "USE_WALLET" })).toBe(initialState);
    expect(reduce({ step: "backup", mnemonic: M }, { type: "USE_WALLET" })).toEqual({ step: "backup", mnemonic: M });
    expect(reduce({ step: "restore", error: null }, { type: "USE_WALLET" })).toEqual({ step: "wallet", error: null });
    expect(reduce({ step: "wallet", error: null }, { type: "BACK" })).toEqual({ step: "restore", error: null });
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

  it("reports progress without a confirm step", () => {
    expect(progressOf({ step: "backup", mnemonic: M })).toEqual([1, 6]);
    expect(progressOf({ step: "passphrase", mnemonic: M, origin: "create" })).toEqual([2, 6]);
    expect(progressOf({ step: "recovery", label: "a" })).toEqual([5, 6]);
    expect(progressOf({ step: "restore", error: null })).toEqual([1, 6]);
  });
});
