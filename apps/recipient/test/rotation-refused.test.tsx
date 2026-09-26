// The World ID failure path (docs/worldid.md, "Failure path"): someone with a stolen recovery phrase
// restores the victim's account and tries to move the name to keys they control, confirming with
// THEIR OWN World ID. The API refuses (403 session_mismatch) and Name settings shows a prominent
// refusal; nothing is saved and the name keeps its keys.
import { useEffect, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { generateMnemonic, keysFromMnemonic, sessionSignal, type SoapayKeys } from "@soapay/sdk";
import { ApiError } from "../src/api/client.js";
import { API_REFUSALS, refusalFromApi, refusalFromWorldApp } from "../src/features/rotation/refusal.js";
import { resetSessionRestoreAttempts } from "../src/hooks/useSessionRestore.js";
import { InviteProvider } from "../src/hooks/useInvite.js";
import { claimName, registerMetaAddress } from "../src/onboarding/actions.js";
import { NameSettings } from "../src/screens/NameSettings.js";
import { ServicesProvider, buildServices } from "../src/services/ServicesProvider.js";
import { deleteEnvelope } from "../src/vault/idb.js";
import { VaultProvider, useVault } from "../src/vault/VaultProvider.js";
import { defaultSettings, type Profile, type VaultData } from "../src/vault/types.js";
import { mockSessionResult } from "../src/worldid/MockHumanCheck.js";
import type { HumanCheckProps } from "../src/worldid/types.js";

/** What the World ID step answers in the next test: a proof of some session, or a World ID app error. */
let answer: { kind: "proof"; sessionId: string } | { kind: "error"; code: string } = { kind: "error", code: "cancelled" };

// A stand-in for <HumanCheck>: one button that answers as `answer` says.
vi.mock("../src/worldid/index.js", async (orig) => {
  const real = await orig<typeof import("../src/worldid/index.js")>();
  return {
    ...real,
    HumanCheck: (p: HumanCheckProps) => (
      <button
        type="button"
        data-testid="world-id-answer"
        onClick={() => {
          if (answer.kind === "proof") {
            void p.onResult(mockSessionResult({ mode: "rotate", sessionId: answer.sessionId, signal: p.signal }));
          } else {
            p.onError?.(Object.assign(new Error(`World ID failed: ${answer.code}`), { code: answer.code }));
          }
        }}
      >
        World ID answers
      </button>
    ),
  };
});

const chainId = defaultSettings().chainId;
const services = buildServices({ ...defaultSettings(), apiUrl: "http://mock" }, true);
const uniqueLabel = () => `v${Math.random().toString(36).slice(2, 10)}`;

/** The victim's device: registered, and the name claimed with the victim's World ID session. */
async function victimName(keys: SoapayKeys, label: string): Promise<string> {
  await registerMetaAddress({ api: services.api, client: services.client, keys, chainId });
  const session = mockSessionResult({ mode: "create-session", signal: sessionSignal(label, keys.registrantAddress) });
  await claimName({ api: services.api, keys, chainId, label, session });
  return (session as { session_id: string }).session_id;
}

let vaultData: VaultData | null = null;

/** The thief's browser: the victim's phrase restored, the name's session id read back (D-64 self-heal). */
function Restored({ mnemonic, profile, children }: { mnemonic: string; profile: Profile; children: ReactNode }) {
  const vault = useVault();
  vaultData = vault.data ?? null;
  useEffect(() => {
    if (vault.status !== "empty") return;
    void (async () => {
      await vault.create(mnemonic, "correct horse battery staple");
      await vault.update((d) => ({ ...d, profile: { ...profile, onboardedAt: Date.now() } }));
    })();
  }, [vault, mnemonic, profile]);
  return vault.status === "unlocked" && vault.data?.profile.onboardedAt ? <>{children}</> : null;
}

async function thiefTriesToRotate() {
  const mnemonic = generateMnemonic(); // the victim's phrase, now in the thief's hands
  const keys = keysFromMnemonic(mnemonic);
  const label = uniqueLabel();
  const sessionId = await victimName(keys, label);
  const before = await services.api.getName(label);
  const profile: Profile = {
    name: { label, name: `${label}.soapay.eth`, at: Date.now() },
    recovery: { kind: "world-id", at: Date.now(), sessionId, attachedTo: label, restored: true, restoredNoticeShown: true },
  };
  render(
    <VaultProvider idleLockMs={0}>
      <ServicesProvider override={services}>
        <InviteProvider hash="#/">
          <MemoryRouter>
            <Restored mnemonic={mnemonic} profile={profile}>
              <NameSettings />
            </Restored>
          </MemoryRouter>
        </InviteProvider>
      </ServicesProvider>
    </VaultProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Rotate to new keys/ }, { timeout: 10_000 }));
  expect((await screen.findByTestId("rotation-confirm")).getAttribute("data-path")).toBe("attested");
  await user.click(screen.getByRole("button", { name: "Continue to World ID" }));
  await user.click(await screen.findByTestId("world-id-answer"));
  return { label, sessionId, before: before!, user, meta: keys.metaAddressURI };
}

/** Nothing was saved or changed anywhere. */
async function expectNothingChanged(label: string, beforeMeta: string) {
  expect(vaultData!.profile.pendingRotation).toBeUndefined();
  expect(vaultData!.profile.keyGeneration ?? 0).toBe(0);
  expect(vaultData!.profile.rotations ?? []).toHaveLength(0);
  expect((await services.api.getName(label))!.metaAddress).toBe(beforeMeta);
  expect(screen.queryByText(/A rotation is half done/)).toBeNull();
}

beforeEach(async () => {
  await deleteEnvelope();
  resetSessionRestoreAttempts();
  vaultData = null;
});

describe("rotation refused: a different person's World ID", () => {
  it("API session_mismatch: prominent refusal, nothing saved, the name keeps its keys", async () => {
    answer = { kind: "proof", sessionId: `session_${"ab".repeat(16)}` }; // the thief's own World ID session
    const { label, before, user, meta } = await thiefTriesToRotate();

    const box = await screen.findByTestId("rotation-refused", {}, { timeout: 10_000 });
    expect(box.getAttribute("data-code")).toBe("session_mismatch");
    expect(box.getAttribute("data-kind")).toBe("different-person");
    expect(screen.getByRole("alert").textContent).toContain(`Refused: this World ID isn't the person linked to ${label}.soapay.eth`);
    expect(box.textContent).toContain("Nothing changed.");
    expect(box.textContent).toContain("Soapay API answered: session_mismatch");
    expect(screen.getByTestId("refused-current-meta").textContent!.toLowerCase()).toBe(`${meta.slice(0, 17)}…${meta.slice(-8)}`.toLowerCase());
    await expectNothingChanged(label, before.metaAddress);

    // Back returns to the idle screen, still with no half-done rotation.
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: /Rotate to new keys/ })).toBeTruthy();
    await expectNothingChanged(label, before.metaAddress);
  });

  it("World ID app can't prove the linked session: refusal from the app, nothing sent to the API", async () => {
    answer = { kind: "error", code: "verification_rejected" };
    const { label, before } = await thiefTriesToRotate();
    const box = await screen.findByTestId("rotation-refused", {}, { timeout: 10_000 });
    expect(box.getAttribute("data-code")).toBe("verification_rejected");
    expect(box.textContent).toContain(`Refused: World ID didn't confirm the person linked to ${label}.soapay.eth`);
    expect(box.textContent).toContain("World ID app answered: verification_rejected");
    await expectNothingChanged(label, before.metaAddress);
  });

  it("the person backing out in the World ID app is not a refusal", async () => {
    answer = { kind: "error", code: "user_rejected" };
    const { label, before } = await thiefTriesToRotate();
    expect(await screen.findByRole("button", { name: /Rotate to new keys/ }, { timeout: 10_000 })).toBeTruthy();
    expect(screen.queryByTestId("rotation-refused")).toBeNull();
    await expectNothingChanged(label, before.metaAddress);
  });
});

describe("refusal copy", () => {
  const name = "sam.soapay.eth";
  const api = (code: string, status = 403) => new ApiError(status, code, "raw message");

  it("covers every World ID refusal code the rotation route can return, in plain words", () => {
    const codes = [
      "session_mismatch",
      "no_session",
      "session_cooldown",
      "session_replayed",
      "request_used",
      "unknown_request",
      "signal_mismatch",
      "request_expired",
      "expired",
      "proof_invalid",
      "proof_cancelled",
      "proof_missing",
      "proof_malformed",
      "legacy_proof_unsupported",
      "wrong_credential",
      "environment_mismatch",
      "worldid_unavailable",
      "worldid_disabled",
      "attester_disabled",
    ];
    expect(Object.keys(API_REFUSALS).sort()).toEqual([...codes].sort());
    for (const code of codes) {
      const r = refusalFromApi(api(code), name)!;
      expect(r.code).toBe(code);
      expect(r.source).toBe("api");
      expect(r.reason.length).toBeGreaterThan(20);
      expect(r.reason).not.toContain("_"); // no raw codes in the explanation
      if (r.kind !== "unavailable") expect(r.title).toMatch(/^Refused: /);
    }
  });

  it("names the three demo cases precisely", () => {
    expect(refusalFromApi(api("session_mismatch"), name)).toMatchObject({
      kind: "different-person",
      title: "Refused: this World ID isn't the person linked to sam.soapay.eth",
    });
    expect(refusalFromApi(api("no_session", 409), name)).toMatchObject({ kind: "no-link", title: "Refused: sam.soapay.eth has no World ID link" });
    expect(refusalFromApi(api("session_replayed"), name)).toMatchObject({ kind: "replay" });
    expect(refusalFromApi(api("request_used"), name)).toMatchObject({ kind: "replay" });
  });

  it("leaves non-World ID errors to the generic error line", () => {
    for (const code of ["bad_signature", "stale_rotation", "no_change", "invalid_body", "http_429"]) expect(refusalFromApi(api(code, 400), name)).toBeNull();
    expect(refusalFromApi(new Error("network down"), name)).toBeNull();
  });

  it("World ID app errors: cancels go back quietly, connection trouble judges nothing, anything else is a refusal", () => {
    const err = (code: string) => Object.assign(new Error(code), { code });
    expect(refusalFromWorldApp(err("user_rejected"), name)).toBeNull();
    expect(refusalFromWorldApp(err("cancelled"), name)).toBeNull();
    expect(refusalFromWorldApp(err("timeout"), name)).toMatchObject({ kind: "unavailable", source: "world-app" });
    expect(refusalFromWorldApp(err("api_unreachable"), name)).toMatchObject({ kind: "unavailable" });
    expect(refusalFromWorldApp(err("no_session"), name)).toMatchObject({ kind: "no-link" });
    expect(refusalFromWorldApp(err("generic_error"), name)).toMatchObject({ kind: "different-person", title: "Refused: World ID didn't confirm the person linked to sam.soapay.eth" });
  });
});

