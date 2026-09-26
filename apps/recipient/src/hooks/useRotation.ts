import { useCallback, useState } from "react";
import { attachSession } from "../features/recovery/attach.js";
import {
  finishRotation,
  prepareRotation,
  registerRotatedMeta,
  submitRotation,
  type RotationDraft,
  type RotationStage,
} from "../features/rotation/flow.js";
import { canonicalMeta } from "../features/rotation/claim.js";
import { useServices } from "../services/ServicesProvider.js";
import { errorMessage } from "../ui/kit.js";
import { useUnlocked } from "../vault/VaultProvider.js";
import { adoptRecoveryPhrase, hasRecoveryPhrase, phraseOffsetOf, type PendingRotation, type Profile } from "../vault/types.js";
import type { HumanCheckResult } from "../worldid/types.js";
import { useKeyRing } from "./useChain.js";

export type RotationPath = "attested" | "manual";

export type RotationState =
  | { step: "idle"; error: string | null }
  /** Review what will happen; `path` depends on whether a World ID session is attached to the name. */
  | { step: "confirm"; draft: RotationDraft; path: RotationPath }
  /** Attested path: waiting for `<HumanCheck mode="rotate">`. */
  | { step: "human"; draft: RotationDraft }
  | { step: "working"; stage: RotationStage | "register"; path: RotationPath }
  | { step: "done"; path: RotationPath };

/**
 * Whether rotation can be attested by World ID: a session is attached to this name and, if it was
 * attached late, the API's cooldown has passed.
 */
export function rotationPathOf(profile: Profile, nowMs = Date.now()): RotationPath {
  const r = profile.recovery;
  if (!r?.sessionId || !profile.name || r.attachedTo !== profile.name.label) return "manual";
  if (r.rotationAllowedFrom && nowMs < r.rotationAllowedFrom * 1000) return "manual";
  return "attested";
}

/** When a late-attached session starts backing rotations (ms), or null if it already does / none. */
export function sessionCooldownUntil(profile: Profile, nowMs = Date.now()): number | null {
  const from = profile.recovery?.rotationAllowedFrom;
  return from && nowMs < from * 1000 ? from * 1000 : null;
}

/**
 * Key rotation (§2.1) and recovery-session management as one hook. Screens render `state` and call
 * the actions; persistence (pendingRotation, keyGeneration, rotations) happens here.
 */
export function useRotation() {
  const v = useUnlocked();
  const svc = useServices();
  const ring = useKeyRing();
  const profile = v.data.profile;
  const name = profile.name;
  const [state, setState] = useState<RotationState>({ step: "idle", error: null });
  const [attachError, setAttachError] = useState<string | null>(null);
  const path = rotationPathOf(profile);
  const chainId = svc.settings.chainId;

  const fail = (e: unknown) => setState({ step: "idle", error: errorMessage(e) });

  const start = useCallback(() => {
    if (!name) return setState({ step: "idle", error: "Claim a name first: rotation moves a name to new keys." });
    if (profile.pendingRotation) return setState({ step: "idle", error: "Finish the pending rotation first." });
    // Wallet-signature accounts rotate by moving to a recovery-phrase account first (owner decision
    // 2026-09-26): `adoptPhrase`, then this same route. See vault/types.ts adoptRecoveryPhrase.
    if (!hasRecoveryPhrase(v.data)) {
      return setState({
        step: "idle",
        error: "Rotating means moving to a recovery-phrase account. Create your recovery phrase first (step 1 below).",
      });
    }
    const draft = prepareRotation({
      mnemonic: v.data.mnemonic,
      label: name.label,
      currentGeneration: profile.keyGeneration ?? 0,
      oldMeta: ring.current.metaAddressURI,
      phraseOffset: phraseOffsetOf(v.data),
    });
    setState({ step: "confirm", draft, path });
  }, [name, profile.pendingRotation, profile.keyGeneration, v.data, ring, path]);

  /** Sends the registrant's setText and records the rotation as complete. */
  const complete = useCallback(
    async (pending: PendingRotation) => {
      if (!name) throw new Error("No name to rotate.");
      setState({ step: "working", stage: "setText", path: pending.path });
      const { setTextTx } = await finishRotation({
        ens: svc.ens,
        name: name.name,
        newMeta: pending.newMeta,
        registrantKey: ring.current.registrantKey,
      });
      await v.update((d) => {
        const { pendingRotation: _p, ...rest } = d.profile;
        return {
          ...d,
          profile: {
            ...rest,
            keyGeneration: pending.generation,
            rotations: [
              ...(d.profile.rotations ?? []),
              {
                generation: pending.generation,
                path: pending.path,
                oldMeta: pending.oldMeta,
                newMeta: pending.newMeta,
                at: Date.now(),
                setTextTx,
                ...(pending.attestation !== undefined ? { attestation: pending.attestation } : {}),
              },
            ],
          },
        };
      });
      setState({ step: "done", path: pending.path });
    },
    [name, svc.ens, ring, v],
  );

  const savePending = (p: PendingRotation) => v.update((d) => ({ ...d, profile: { ...d.profile, pendingRotation: p } }));

  /** Manual path: register the new meta via the relayer, then setText. The employer approves by hand. */
  const runManual = useCallback(
    async (pending: PendingRotation) => {
      if (!pending.registered) {
        setState({ step: "working", stage: "register", path: "manual" });
        await registerRotatedMeta({ api: svc.api, registry: svc.client, chainId, registrant: ring.current, newMeta: pending.newMeta });
        pending = { ...pending, registered: true };
        await savePending(pending);
      }
      await complete(pending);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [svc.api, svc.client, chainId, ring, complete],
  );

  const confirm = useCallback(async () => {
    if (state.step !== "confirm") return;
    const { draft } = state;
    if (state.path === "attested") return setState({ step: "human", draft });
    try {
      const pending: PendingRotation = {
        generation: draft.generation,
        oldMeta: draft.oldMeta,
        newMeta: draft.newMeta,
        postedAt: Date.now(),
        path: "manual",
        registered: false,
      };
      await savePending(pending);
      await runManual(pending);
    } catch (e) {
      fail(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, runManual]);

  /** Attested path: the World ID result arrived. */
  const onHuman = useCallback(
    async (r: HumanCheckResult) => {
      if (state.step !== "human") return;
      const { draft } = state;
      try {
        const res = await submitRotation({
          api: svc.api,
          registry: svc.client,
          chainId,
          draft,
          registrant: ring.current,
          worldId: r,
          onStage: (stage) => setState({ step: "working", stage, path: "attested" }),
        });
        const pending: PendingRotation = {
          generation: draft.generation,
          oldMeta: draft.oldMeta,
          newMeta: draft.newMeta,
          postedAt: Date.now(),
          path: "attested",
          ...(res.attestation ? { attestation: res.attestation } : {}),
        };
        await savePending(pending);
        await complete(pending);
      } catch (e) {
        fail(e);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, svc.api, svc.client, chainId, ring, complete],
  );

  /** Retry the on-chain part of a rotation the API (or relayer) already accepted. */
  const resume = useCallback(async () => {
    const p = profile.pendingRotation;
    if (!p) return;
    try {
      if (p.path === "manual") await runManual(p);
      else await complete(p);
    } catch (e) {
      fail(e);
    }
  }, [profile.pendingRotation, runManual, complete]);

  const cancel = useCallback(() => setState({ step: "idle", error: null }), []);

  /**
   * Step 1 of moving a wallet-signature account to a phrase account: store the new phrase (already
   * shown to and confirmed by the user) in the vault. Generation 1 onward then comes from it.
   */
  const adoptPhrase = useCallback(
    async (mnemonic: string) => {
      await v.update((d) => adoptRecoveryPhrase(d, mnemonic));
      setState({ step: "idle", error: null });
    },
    [v],
  );

  /** Attach a freshly created World ID session to the name (POST /names/:label/session). */
  const attach = useCallback(
    async (r: HumanCheckResult) => {
      setAttachError(null);
      if (!name) return setAttachError("Claim a name first.");
      try {
        const res = await attachSession({ api: svc.api, chainId, label: name.label, result: r, registrantKey: ring.current.registrantKey });
        await v.update((d) => ({
          ...d,
          profile: {
            ...d.profile,
            recovery: { kind: "world-id", at: Date.now(), sessionId: res.sessionId, attachedTo: name.label, rotationAllowedFrom: res.rotationAllowedFrom },
            recoverySkipped: false,
          },
        }));
      } catch (e) {
        setAttachError(errorMessage(e));
      }
    },
    [name, svc.api, chainId, ring, v],
  );

  return {
    state,
    path,
    name,
    currentMeta: canonicalMeta(ring.current.metaAddressURI),
    generation: profile.keyGeneration ?? 0,
    /** False until a wallet-signature account has moved to a recovery phrase (`adoptPhrase`). */
    canRotate: hasRecoveryPhrase(v.data),
    /** Wallet-signature account: rotating = moving to a phrase account (guided path on the Name screen). */
    walletKeys: Boolean(v.data.walletKeys),
    /** The account moved from wallet-signature keys to a phrase; old addresses stay spendable. */
    migrated: Boolean(v.data.walletKeys) && hasRecoveryPhrase(v.data),
    adoptPhrase,
    rotations: profile.rotations ?? [],
    pending: profile.pendingRotation ?? null,
    recovery: profile.recovery ?? null,
    /** A late-attached session is still in the API's cooldown until this time (ms). */
    cooldownUntil: sessionCooldownUntil(profile),
    sessionId: path === "attested" ? profile.recovery?.sessionId : undefined,
    ensReady: svc.ens.ready,
    ensUnavailableReason: svc.ens.unavailableReason,
    attachError,
    start,
    confirm,
    onHuman,
    resume,
    cancel,
    attach,
  };
}
