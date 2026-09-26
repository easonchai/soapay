// Per-browser settings (config.ts). Saving reloads the page: wagmi, services and the
// resolver are built once at startup from the resolved config.
import { useCallback, useState } from "react";
import { getAddress, isAddress } from "viem";
import { loadSettings, resetSettings, saveSettings, SUPPORTED_CHAIN_IDS, type Settings, type SupportedChainId } from "../config.js";

export type SettingsForm = {
  chainId: SupportedChainId;
  stealthDisperse: string;
  rpcUrl: string;
  ensRpcUrl: string;
};

export type SettingsState = {
  form: SettingsForm;
  chainIds: readonly SupportedChainId[];
  error: string | null;
  set<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]): void;
  save(): void;
  reset(): void;
};

function toForm(s: Settings, chainId: SupportedChainId = s.chainId): SettingsForm {
  return {
    chainId,
    stealthDisperse: s.stealthDisperse[chainId] ?? "",
    rpcUrl: s.rpcUrl[chainId] ?? "",
    ensRpcUrl: s.ensRpcUrl[chainId] ?? "",
  };
}

function withValue<T>(rec: Partial<Record<SupportedChainId, T>>, chainId: SupportedChainId, v: T | undefined) {
  const out = { ...rec };
  if (v === undefined) delete out[chainId];
  else out[chainId] = v;
  return out;
}

export function useSettings(reload: () => void = () => location.reload()): SettingsState {
  const [base] = useState(loadSettings);
  const [form, setForm] = useState<SettingsForm>(() => toForm(base));
  const [error, setError] = useState<string | null>(null);

  const set = useCallback(
    <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
      setError(null);
      // Switching chains shows that chain's own values: addresses are never shared across chains.
      setForm((f) => (key === "chainId" ? toForm(base, value as SupportedChainId) : { ...f, [key]: value }));
    },
    [base],
  );

  const save = useCallback(() => {
    const d = form.stealthDisperse.trim();
    if (d && !isAddress(d)) return setError("StealthDisperse must be an address");
    const c = form.chainId;
    saveSettings({
      chainId: c,
      stealthDisperse: withValue(base.stealthDisperse, c, d ? getAddress(d) : undefined),
      rpcUrl: withValue(base.rpcUrl, c, form.rpcUrl.trim() || undefined),
      ensRpcUrl: withValue(base.ensRpcUrl, c, form.ensRpcUrl.trim() || undefined),
    });
    reload();
  }, [base, form, reload]);

  const reset = useCallback(() => {
    resetSettings();
    reload();
  }, [reload]);

  return { form, chainIds: SUPPORTED_CHAIN_IDS, error, set, save, reset };
}
