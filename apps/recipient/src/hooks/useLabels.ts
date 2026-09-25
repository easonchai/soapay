import { useCallback, useMemo } from "react";
import type { AddressLabel } from "@soapay/sdk";
import { getAddress, isAddress, type Address } from "viem";
import { useChain } from "./useChain.js";
import { graphOf } from "./useWallet.js";

export const LABEL_OPTIONS: { value: AddressLabel; title: string; hint: string }[] = [
  { value: "main-wallet", title: "My main wallet", hint: "Coworkers likely know it. Sending here identifies the cluster." },
  { value: "exchange", title: "Exchange deposit", hint: "Tied to your KYC identity." },
  { value: "coworker-known", title: "Known to coworkers", hint: "Any address a colleague could recognise." },
  { value: "other", title: "Other", hint: "Tracked, but not treated as identifying." },
];

export type LabelRow = { address: Address; label: AddressLabel; stealth: boolean };

/** Address labels the privacy guard uses (stored in the encrypted cluster graph). */
export function useLabels() {
  const { state, updateChain } = useChain();
  const rows = useMemo<LabelRow[]>(
    () =>
      (state.graph?.nodes ?? [])
        .filter((n) => n.label)
        .map((n) => ({ address: n.address, label: n.label!, stealth: n.kind === "stealth" })),
    [state.graph],
  );

  const setLabel = useCallback(
    async (address: string, label: AddressLabel | undefined) => {
      if (!isAddress(address.trim(), { strict: false })) throw new Error("Enter a valid 0x address.");
      const a = getAddress(address.trim());
      await updateChain((latest) => {
        const g = graphOf(latest);
        if (!g.has(a)) g.addExternal(a);
        g.setLabel(a, label);
        return { ...latest, graph: g.toJSON() };
      });
    },
    [updateChain],
  );

  return { rows, setLabel, remove: (a: Address) => setLabel(a, undefined) };
}
