/**
 * Onboarding state machine (PRD Flow 1). Pure: no I/O, no randomness (callers pass the mnemonic in), so
 * every transition is unit-testable.
 *
 *   welcome ─create→ backup (save the recovery kit) ─saved→ passphrase ─vault→ register → name ─chosen→ recovery → share
 *          └restore→ restore ─valid (typed or kit file)→ passphrase ─┘                  └──skip name──────────┘
 *                    └wallet (older signature accounts only)→ wallet ─signed→ passphrase
 *
 * `recovery` is OPTIONAL (docs/mvp-spec.md §5): a World ID Selfie Check session for self-service key
 * rotation later. The session signal binds label + registrant, so it comes after the label is chosen,
 * and the name is claimed in that step (with `worldIdSession`, or without it on skip).
 *
 * The mnemonic lives only in the pre-vault states; once the vault is created it is dropped from the
 * machine (the vault holds it, encrypted). The seed is shown exactly once, in `backup` (D-44: save a recovery
 * kit, no memorise-quiz). Going back from the Lock step returns to `backup` with `saved: true`, which does
 * not show the phrase again.
 *
 * D-45: new accounts can't be made from a wallet signature any more. The `wallet` step stays reachable
 * only from `restore`, so accounts made that way before can still be recovered.
 */
import type { Profile, WalletKeySecret } from "../vault/types.js";

export type Origin = "create" | "restore" | "wallet";

export type OnboardingState =
  | { step: "welcome" }
  /** `saved`: the kit was already saved (came back from the Lock step); the phrase isn't shown again. */
  | { step: "backup"; mnemonic: string; saved?: boolean }
  | { step: "restore"; error: string | null }
  | { step: "wallet"; error: string | null }
  /** `wallet` is set (and `mnemonic` is "") for the wallet-signature key option. */
  | { step: "passphrase"; mnemonic: string; origin: Origin; wallet?: WalletKeySecret }
  | { step: "register" }
  | { step: "name" }
  | { step: "recovery"; label: string; inviteCode?: `0x${string}` }
  | { step: "share" }
  | { step: "done" };

export type OnboardingEvent =
  | { type: "CREATE"; mnemonic: string }
  | { type: "BACKED_UP" }
  | { type: "RESTORE" }
  | { type: "USE_WALLET" }
  | { type: "WALLET_SIGNED"; wallet: WalletKeySecret }
  | { type: "WALLET_FAILED"; error: string }
  | { type: "RESTORE_SUBMIT"; mnemonic: string; valid: boolean }
  | { type: "BACK" }
  | { type: "VAULT_CREATED" }
  | { type: "REGISTERED" }
  | { type: "NAME_CHOSEN"; label: string; inviteCode?: `0x${string}` }
  | { type: "NAMED" }
  | { type: "SKIP_NAME" }
  | { type: "FINISH" };

export const initialState: OnboardingState = { step: "welcome" };

/** Where to resume after an unlock, from what the vault already records. */
export function resumeState(profile: Profile): OnboardingState {
  if (profile.onboardedAt) return { step: "done" };
  if (!profile.registration) return { step: "register" };
  // A label chosen but not claimed isn't persisted: resume at the name step.
  if (!profile.name && !profile.nameSkipped) return { step: "name" };
  return { step: "share" };
}

export function words(mnemonic: string): string[] {
  return mnemonic.trim().split(/\s+/);
}

export function reduce(state: OnboardingState, event: OnboardingEvent): OnboardingState {
  switch (state.step) {
    case "welcome":
      if (event.type === "CREATE") return { step: "backup", mnemonic: event.mnemonic };
      if (event.type === "RESTORE") return { step: "restore", error: null };
      return state;

    // Recovering an older wallet-signature account (plain EOAs only; D-45). The screen checks the account
    // and the signatures with the SDK (`assertPlainEoa`, `keysFromWalletSignature`) and reports here.
    case "wallet":
      if (event.type === "BACK") return { step: "restore", error: null };
      if (event.type === "WALLET_FAILED") return { step: "wallet", error: event.error };
      if (event.type === "WALLET_SIGNED") return { step: "passphrase", mnemonic: "", origin: "wallet", wallet: event.wallet };
      return state;

    case "backup":
      if (event.type === "BACKED_UP") return { step: "passphrase", mnemonic: state.mnemonic, origin: "create" };
      // Leaving the kit screen discards this seed; a new one is generated next time.
      if (event.type === "BACK") return { step: "welcome" };
      return state;

    case "restore":
      if (event.type === "BACK") return { step: "welcome" };
      if (event.type === "USE_WALLET") return { step: "wallet", error: null };
      if (event.type === "RESTORE_SUBMIT") {
        return event.valid
          ? { step: "passphrase", mnemonic: event.mnemonic, origin: "restore" }
          : { step: "restore", error: "That isn't a valid recovery phrase. Check the spelling and word order." };
      }
      return state;

    case "passphrase":
      if (event.type === "VAULT_CREATED") return { step: "register" };
      if (event.type === "BACK") {
        if (state.origin === "wallet") return { step: "wallet", error: null };
        return state.origin === "create" ? { step: "backup", mnemonic: state.mnemonic, saved: true } : { step: "restore", error: null };
      }
      return state;

    case "register":
      if (event.type === "REGISTERED") return { step: "name" };
      return state;

    case "recovery":
      if (event.type === "NAMED") return { step: "share" };
      if (event.type === "BACK") return { step: "name" };
      return state;

    case "name":
      if (event.type === "NAME_CHOSEN") {
        return event.inviteCode ? { step: "recovery", label: event.label, inviteCode: event.inviteCode } : { step: "recovery", label: event.label };
      }
      if (event.type === "SKIP_NAME") return { step: "share" };
      return state;

    case "share":
      if (event.type === "FINISH") return { step: "done" };
      return state;

    case "done":
      return state;
  }
}

/** Progress indicator: [current index, total], counting the steps a user sees. */
export function progressOf(state: OnboardingState): [number, number] {
  const order = ["welcome", "backup", "passphrase", "register", "name", "recovery", "share"];
  const step = state.step === "restore" || state.step === "wallet" ? "backup" : state.step === "done" ? "share" : state.step;
  return [order.indexOf(step), order.length - 1];
}
