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
import type { PendingRotation, Profile } from "../vault/types.js";
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

/** Whether rotation can be attested by World ID (a session exists and is attached to this name). */
export function rotationPathOf(profile: Profile): RotationPath {
  const r = profile.recovery;
  return r?.sessionId && profile.name && r.attachedTo === profile.name.label ? "attested" : "manual";
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
    const draft = prepareRotation({
      mnemonic: v.data.mnemonic,
      label: name.label,
      currentGeneration: profile.keyGeneration ?? 0,
      oldMeta: ring.current.metaAddressURI,
    });
    setState({ step: "confirm", draft, path });
  }, [name, profile.pendingRotation, profile.keyGeneration, v.data.mnemonic, ring, path]);

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

  /** Attach a freshly created World ID session to the name (POST /names/:label/session). */
  const attach = useCallback(
    async (r: HumanCheckResult) => {
      setAttachError(null);
      if (!name) return setAttachError("Claim a name first.");
      try {
        const { sessionId } = await attachSession({ api: svc.api, chainId, label: name.label, result: r, registrantKey: ring.current.registrantKey });
        await v.update((d) => ({
          ...d,
          profile: { ...d.profile, recovery: { kind: "world-id", at: Date.now(), sessionId, attachedTo: name.label }, recoverySkipped: false },
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
    rotations: profile.rotations ?? [],
    pending: profile.pendingRotation ?? null,
    recovery: profile.recovery ?? null,
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
