/**
 * The wallet-signature key option (CK's M1 derivation, decision-ck-integration: "an option for plain
 * EOAs only"). The recovery phrase stays the default. All checks and derivation are the SDK's
 * (`assertPlainEoa`, `keysFromWalletSignature`); this module only talks to the wallet.
 *
 * Order matters: the account's code is read BEFORE any signature is requested, so a smart or passkey
 * wallet is refused without asking the user to sign. The wallet then signs SIGN_MESSAGE twice; the two
 * signatures must be identical (RFC 6979), or signing again on another device would not recover the keys.
 */
import { SIGN_MESSAGE, assertPlainEoa, keysFromWalletSignature, type SoapayKeys } from "@soapay/sdk";
import { getAddress, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { WalletKeySecret } from "../vault/types.js";

/** An injected EIP-1193 provider (window.ethereum). No wagmi: one connect, one getCode, two signatures. */
export type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

export type KeyWallet = {
  /** Short label for the UI ("MetaMask", "Demo EOA"). */
  name: string;
  connect(): Promise<Address>;
  /** eth_getCode of `address` on every chain we can see; "0x" when none has code. */
  getCode(address: Address): Promise<Hex>;
  signMessage(address: Address, message: string): Promise<Hex>;
};

export function injectedProvider(): Eip1193 | null {
  const eth = (globalThis as { ethereum?: Eip1193 }).ethereum;
  return eth && typeof eth.request === "function" ? eth : null;
}

/**
 * `extraCode` reads the account's code on the payroll chain too (the wallet may sit on another chain,
 * and a smart account can be deployed on one chain but not another).
 */
export function injectedKeyWallet(provider: Eip1193, extraCode?: (address: Address) => Promise<Hex | undefined>): KeyWallet {
  return {
    name: "Browser wallet",
    async connect() {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const first = accounts?.[0];
      if (!first) throw new Error("The wallet didn't share an account.");
      return getAddress(first);
    },
    async getCode(address) {
      const own = ((await provider.request({ method: "eth_getCode", params: [address, "latest"] })) as Hex | null) ?? "0x";
      if (own !== "0x") return own;
      return (await extraCode?.(address)) ?? "0x";
    },
    async signMessage(address, message) {
      return (await provider.request({ method: "personal_sign", params: [toHex(message), address] })) as Hex;
    },
  };
}

/** Mock mode: a throwaway plain EOA, so the option can be clicked through offline. */
export function demoEoaWallet(): KeyWallet {
  // Fixed demo key (well-known Hardhat account #1): holds nothing, never used outside mock mode.
  const acct = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  return {
    name: "Demo EOA",
    connect: async () => acct.address,
    getCode: async () => "0x",
    signMessage: (_a, message) => acct.signMessage({ message }),
  };
}

/** Mock mode: a smart account (it has code), to show the refusal. */
export function demoSmartWallet(): KeyWallet {
  const acct = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
  return {
    name: "Demo smart wallet",
    connect: async () => acct.address,
    getCode: async () => "0x6080604052",
    signMessage: () => Promise.reject(new Error("unreachable: refused before signing")),
  };
}

export type WalletKeysResult = { secret: WalletKeySecret; keys: SoapayKeys };

/** Connect, refuse smart/passkey wallets up front, sign twice, derive. Throws a user-facing message. */
export async function deriveWalletKeys(wallet: KeyWallet, onStage?: (s: "connect" | "check" | "sign1" | "sign2") => void): Promise<WalletKeysResult> {
  onStage?.("connect");
  const address = await wallet.connect();
  onStage?.("check");
  const code = await wallet.getCode(address);
  assertPlainEoa(address, code);
  onStage?.("sign1");
  const signature = await wallet.signMessage(address, SIGN_MESSAGE);
  onStage?.("sign2");
  const confirmSignature = await wallet.signMessage(address, SIGN_MESSAGE);
  const keys = await keysFromWalletSignature({ address, code, signature, confirmSignature });
  return { secret: { kind: "wallet-signature", signature, wallet: address }, keys };
}
