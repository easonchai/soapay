import { base } from "viem/chains";
import {
  ERC5564_CONTRACT_ADDRESS,
  ERC6538_CONTRACT_ADDRESS,
  ERC5564_StartBlocks,
  VALID_SCHEME_ID,
} from "@scopelift/stealth-address-sdk";

/** v1 runs on Base only (PRD: every component except the Privacy Pools exit). */
export const SOAPAY_CHAIN = base;

/** ERC-5564 scheme 1: secp256k1 with view tags. */
export const SCHEME_ID = VALID_SCHEME_ID.SCHEME_ID_1;

/** Canonical singletons; never forks (PRD: Components). */
export const ANNOUNCER_ADDRESS = ERC5564_CONTRACT_ADDRESS;
export const REGISTRY_ADDRESS = ERC6538_CONTRACT_ADDRESS;
export const ANNOUNCER_START_BLOCK_BASE = BigInt(ERC5564_StartBlocks.BASE);

/** Native USDC on Base. v1 scope is USDC only. */
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
