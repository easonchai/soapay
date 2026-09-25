/**
 * Onboarding state machine (PRD Flow 1). Pure: no I/O, no randomness (callers pass the mnemonic and
 * the challenge indices in), so every transition is unit-testable.
 *
 *   welcome ─create→ backup ─→ confirm ─ok→ passphrase ─vault→ human → register → name → share
 *          └restore→ restore ─valid→ passphrase ─┘                                 └skip┘
 *
 * The mnemonic lives only in the pre-vault states; once the vault is created it is dropped from the
 * machine (the vault holds it, encrypted). The seed is shown exactly once, in `backup`.
 */
import type { Profile } from "../vault/types.js";

export type Origin = "create" | "restore";

export type OnboardingState =
  | { step: "welcome" }
  | { step: "backup"; mnemonic: string }
  | { step: "confirm"; mnemonic: string; challenge: number[]; error: string | null; attempts: number }
  | { step: "restore"; error: string | null }
  | { step: "passphrase"; mnemonic: string; origin: Origin }
  | { step: "human"; proof: unknown }
  | { step: "register"; proof: unknown }
  | { step: "name"; proof: unknown }
  | { step: "share" }
  | { step: "done" };

export type OnboardingEvent =
  | { type: "CREATE"; mnemonic: string }
  | { type: "BACKED_UP"; challenge: number[] }
  | { type: "CONFIRM"; answers: string[] }
  | { type: "RESTORE" }
  | { type: "RESTORE_SUBMIT"; mnemonic: string; valid: boolean }
  | { type: "BACK" }
  | { type: "VAULT_CREATED" }
  | { type: "HUMAN_VERIFIED"; proof: unknown }
  | { type: "REGISTERED" }
  | { type: "NAMED" }
  | { type: "SKIP_NAME" }
  | { type: "FINISH" };

export const initialState: OnboardingState = { step: "welcome" };

/** Where to resume after an unlock, from what the vault already records. */
export function resumeState(profile: Profile): OnboardingState {
  if (profile.onboardedAt) return { step: "done" };
  if (!profile.human) return { step: "human", proof: undefined };
  if (!profile.registration) return { step: "register", proof: undefined };
  if (!profile.name && !profile.nameSkipped) return { step: "name", proof: undefined };
  return { step: "share" };
}

export function normalizeWord(w: string): string {
  return w.normalize("NFKD").trim().toLowerCase();
}

export function words(mnemonic: string): string[] {
  return mnemonic.trim().split(/\s+/);
}

/** `count` distinct word positions, sorted. `rand` is injectable for tests. */
export function pickChallenge(wordCount: number, count = 3, rand: () => number = Math.random): number[] {
  const picked = new Set<number>();
  while (picked.size < Math.min(count, wordCount)) picked.add(Math.floor(rand() * wordCount));
  return [...picked].sort((a, b) => a - b);
}

export function reduce(state: OnboardingState, event: OnboardingEvent): OnboardingState {
  switch (state.step) {
    case "welcome":
      if (event.type === "CREATE") return { step: "backup", mnemonic: event.mnemonic };
      if (event.type === "RESTORE") return { step: "restore", error: null };
      return state;

    case "backup":
      if (event.type === "BACKED_UP") {
        return { step: "confirm", mnemonic: state.mnemonic, challenge: event.challenge, error: null, attempts: 0 };
      }
      // Leaving the backup screen discards this seed; a new one is generated next time.
      if (event.type === "BACK") return { step: "welcome" };
      return state;

    case "confirm": {
      if (event.type === "BACK") return { step: "backup", mnemonic: state.mnemonic };
      if (event.type !== "CONFIRM") return state;
      const ws = words(state.mnemonic);
      const ok =
        event.answers.length === state.challenge.length &&
        state.challenge.every((idx, i) => normalizeWord(event.answers[i] ?? "") === ws[idx]);
      if (ok) return { step: "passphrase", mnemonic: state.mnemonic, origin: "create" };
      return {
        ...state,
        attempts: state.attempts + 1,
        error: "Those words don't match your backup. Check the numbered positions and try again.",
      };
    }

    case "restore":
      if (event.type === "BACK") return { step: "welcome" };
      if (event.type === "RESTORE_SUBMIT") {
        return event.valid
          ? { step: "passphrase", mnemonic: event.mnemonic, origin: "restore" }
          : { step: "restore", error: "That isn't a valid recovery phrase. Check the spelling and word order." };
      }
      return state;

    case "passphrase":
      if (event.type === "VAULT_CREATED") return { step: "human", proof: undefined };
      if (event.type === "BACK") return state.origin === "create" ? { step: "backup", mnemonic: state.mnemonic } : { step: "restore", error: null };
      return state;

    case "human":
      if (event.type === "HUMAN_VERIFIED") return { step: "register", proof: event.proof };
      return state;

    case "register":
      if (event.type === "REGISTERED") return { step: "name", proof: state.proof };
      return state;

    case "name":
      if (event.type === "NAMED" || event.type === "SKIP_NAME") return { step: "share" };
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
  const order = ["welcome", "backup", "confirm", "passphrase", "human", "register", "name", "share"];
  const step = state.step === "restore" ? "backup" : state.step === "done" ? "share" : state.step;
  return [order.indexOf(step), order.length - 1];
}
