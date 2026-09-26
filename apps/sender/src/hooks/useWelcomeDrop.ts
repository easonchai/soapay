// The Base Sepolia welcome drop (D-52): when a wallet connects, ask the API once for test USDC.
// Returns the drop only when something was sent now; a wallet that already claimed gets nothing.
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { requestWelcomeDrop, welcomeDropEnabled, type WelcomeDrop } from "../lib/sponsorship.js";
import { useStore } from "./store.js";

type SentDrop = Extract<WelcomeDrop, { status: "sent" }>;

/** One request per address per page load; reconnects, re-renders and StrictMode reuse it. */
const asked = new Map<string, Promise<WelcomeDrop | null>>();

export function useWelcomeDrop(address: Address | undefined): { drop: SentDrop | null; dismiss(): void } {
  const { app } = useStore();
  const queryClient = useQueryClient();
  const [drop, setDrop] = useState<SentDrop | null>(null);
  const enabled = welcomeDropEnabled(app);

  useEffect(() => {
    if (!enabled || !address || !app.apiUrl) return;
    const key = `${app.chainId}:${address.toLowerCase()}`;
    let request = asked.get(key);
    if (!request) {
      request = requestWelcomeDrop(app.apiUrl, address);
      asked.set(key, request);
    }
    let live = true;
    void request.then((d) => {
      if (!live || d?.status !== "sent") return;
      setDrop(d);
      // Show the new balance in the pay-run preview.
      void queryClient.invalidateQueries({ queryKey: ["funding"] });
      void queryClient.invalidateQueries({ queryKey: ["wallet-balances"] });
    });
    return () => {
      live = false;
    };
  }, [enabled, address, app.apiUrl, app.chainId, queryClient]);

  return { drop, dismiss: () => setDrop(null) };
}

/** Test hook: forget which addresses were asked. */
export function resetWelcomeDropMemo(): void {
  asked.clear();
}
