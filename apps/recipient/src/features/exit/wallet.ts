/**
 * The destination wallet for a direct withdrawal (D-48): an injected EIP-1193 wallet (window.ethereum)
 * that holds the exit's destination address. It sends `PrivacyPool.withdraw` itself on the destination
 * chain and pays the gas in ETH. No wagmi: one connect, one chain switch, one transaction.
 */
import type { DirectWithdrawSender } from "@soapay/sdk";
import { getAddress, toHex, type Address, type Hash } from "viem";
import type { Eip1193 } from "../../onboarding/walletKeys.js";

export function injectedProvider(): Eip1193 | null {
  return (globalThis as { ethereum?: Eip1193 }).ethereum ?? null;
}

/**
 * Connects the injected wallet and checks it controls `destination` (the pool pays `msg.sender`, and
 * the proof is bound to the destination, so no other account can submit it). Throws a readable error
 * otherwise. Switches the wallet to `chainId` before sending.
 */
export async function connectDestinationWallet(destination: Address, chainId: number, provider: Eip1193 | null = injectedProvider()): Promise<DirectWithdrawSender> {
  if (!provider) throw new Error("No browser wallet found. Open this page in the browser that has your destination wallet.");
  const accounts = ((await provider.request({ method: "eth_requestAccounts" })) as string[] | null) ?? [];
  const match = accounts.find((a) => a.toLowerCase() === destination.toLowerCase());
  if (!match) throw new Error(`Connect the destination wallet ${destination} (the wallet shows ${accounts[0] ? getAddress(accounts[0]) : "no account"}).`);
  const from = getAddress(match);
  return {
    address: from,
    async sendTransaction(tx) {
      const want = toHex(tx.chainId);
      const current = (await provider.request({ method: "eth_chainId" })) as string;
      if (current?.toLowerCase() !== want) await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
      return (await provider.request({ method: "eth_sendTransaction", params: [{ from, to: tx.to, data: tx.data }] })) as Hash;
    },
  };
}
