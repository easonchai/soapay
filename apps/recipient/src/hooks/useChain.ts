import { useCallback, useMemo } from "react";
import { keyRing, scanKeysOf, type KeyRing } from "../features/rotation/keys.js";
import { useUnlocked } from "../vault/VaultProvider.js";
import { chainState, settingsOf, type ChainState, type Settings, type VaultData } from "../vault/types.js";

/** Every key generation derived from the seed (rotation). Memoised per mnemonic + generation. */
export function useKeyRing(): KeyRing {
  const v = useUnlocked();
  const mnemonic = v.data.mnemonic;
  const generation = v.data.profile.keyGeneration ?? 0;
  const gen0 = v.keys;
  return useMemo(() => keyRing(mnemonic, generation, gen0), [mnemonic, generation, gen0]);
}

export function useScanKeys() {
  const ring = useKeyRing();
  return useMemo(() => scanKeysOf(ring), [ring]);
}

export type ChainApi = {
  chainId: number;
  settings: Settings;
  state: ChainState;
  /** Applies `fn` to the latest stored state of the active chain and persists it. */
  updateChain(fn: (s: ChainState) => ChainState): Promise<VaultData>;
};

export function useChain(): ChainApi {
  const v = useUnlocked();
  const settings = settingsOf(v.data);
  const chainId = settings.chainId;
  const state = chainState(v.data, chainId);
  const { update } = v;
  const updateChain = useCallback(
    (fn: (s: ChainState) => ChainState) =>
      update((d) => ({ ...d, chains: { ...d.chains, [String(chainId)]: fn(chainState(d, chainId)) } })),
    [update, chainId],
  );
  return { chainId, settings, state, updateChain };
}
