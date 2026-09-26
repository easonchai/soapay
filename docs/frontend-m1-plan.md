# Soapay Frontend M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One plain Next.js app where an employee derives stealth keys, registers gaslessly via a relayer, scans for payments, and an employer pays a pasted list of recipients in one batch with announcements.

**Architecture:** A `web/` Next.js App Router project. All protocol logic lives in pure, unit-tested modules under `src/lib/` that wrap `@scopelift/stealth-address-sdk` and viem. React pages under `src/app/` only call those modules. Secrets (spending, viewing, registrant private keys) live in React memory for the session, derived from one wallet signature, and are never persisted. A mock relayer at `/api/relay` submits `registerKeysOnBehalf` from a server-side dev key. The batch sender is an interface with an EIP-5792 implementation now and a `StealthDisperse` slot for when the teammate's contract ships.

**Tech Stack:** Next.js 15 (App Router, TypeScript), pnpm, viem 2.56.x, wagmi 2.x, @tanstack/react-query 5, @scopelift/stealth-address-sdk 1.0.0-beta.5, vitest. No CSS framework, one `globals.css`.

**Spec:** `docs/specs/2026-09-25-frontend-m1-design.md`

## Global Constraints

- Chain is read from `NEXT_PUBLIC_CHAIN_ID`; supported values `84532` (Base Sepolia, dev default) and `8453` (Base). Nothing else hardcodes a chain.
- Two RPCs: `NEXT_PUBLIC_RPC_URL` (payroll chain) and `NEXT_PUBLIC_MAINNET_RPC_URL` (ENS only).
- Contracts: Announcer `0x55649E01B5Df198D18D95b5cc5051630cfD45564`, Registry `0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538`, scheme id `1`. Imported from the SDK, never retyped.
- Spending, viewing and registrant private keys are never written to `localStorage`, cookies, logs, or the network. The only private key that touches a server is `RELAYER_PRIVATE_KEY`, server-side only.
- The employee's connected wallet never sends a transaction in this app. It only signs one message.
- Stealth addresses and ephemeral keys from a pay run are never persisted by the sender. Only the pinned meta-address per recipient is stored.
- Every pay run re-resolves every recipient. Batch rows are sorted strictly ascending by stealth address before submission; duplicates abort the run.
- Every announce carries ERC-20 metadata `viewTag(1)|selector(4)|token(20)|amount(32)` built with the SDK's `buildMetadataForERC20`.
- Max 400 rows per run.
- UI is plain HTML: `<table>`, `<button>`, `<input>`, text status. No component library, no design pass.
- Tests: vitest, `environment: 'node'`, pure modules only. Pages are verified manually via the self-pay demo.
- Commits on branch `frontend-m1` only. Never merge to `main` without the user's explicit confirmation.

## Review Focus

1. **Metadata from other apps.** Announcements on the shared Announcer may carry metadata that is not 57 bytes or not an ERC-20 layout. The scanner must keep the row (view tag still matched) and show amount as "unknown", not throw. Pinned to Task 5.
2. **Amount with more than 6 decimals or non-numeric.** `parseUnits("1.1234567", 6)` throws. The editor must mark the row invalid, not crash the page. Pinned to Task 3.
3. **Duplicate stealth address within one run.** Two rows for the same recipient produce two different addresses (random ephemeral keys), but a collision must still abort before signing because the contract rejects duplicates. Pinned to Task 4.
4. **Re-resolve changes the meta-address.** A recipient re-registers with new keys. The row must block with "meta-address changed" until the employer accepts, and the pin must update only on accept. Pinned to Task 3.
5. **Registration block unknown.** A user who registered in another browser has no stored registration block. The scanner must fall back to the SDK's chain start block and Settings must allow overriding it. Pinned to Task 8 and Task 5.

---

## File structure

```
web/
  package.json  tsconfig.json  next.config.ts  vitest.config.ts  .env.example  README.md
  src/
    config/chains.ts            chain, RPCs, addresses, explorer from env
    config/wagmi.ts             wagmi config, injected connector only
    lib/stealth/keys.ts         one signature -> spending, viewing, registrant keys, meta-address
    lib/stealth/recipient.ts    parse + resolve a recipient input to a meta-address
    lib/stealth/derive.ts       per-row stealth address + metadata, sort, uniqueness
    lib/stealth/scan.ts         bounded getLogs scan -> ledger entries
    lib/stealth/register.ts     EIP-712 signature with the registrant key, relayer payload, registered check
    lib/batch/types.ts          BatchSender interface, BatchCall
    lib/batch/buildCalls.ts     rows -> transfer + announce calldata
    lib/batch/sendCalls.ts      EIP-5792 sender with sequential fallback
    lib/store/recipientStore.ts localStorage: public recipient state + ledger
    lib/store/senderStore.ts    localStorage: pins + draft text
    lib/format.ts               short(), fmtUnits()
    hooks/KeysProvider.tsx       session keys in memory, sign-to-unlock
    app/layout.tsx  app/providers.tsx  app/page.tsx  app/globals.css
    app/api/relay/route.ts      POST registerKeysOnBehalf with RELAYER_PRIVATE_KEY
    app/receive/page.tsx  Wizard.tsx  Dashboard.tsx
    app/pay/page.tsx  Editor.tsx  Review.tsx  Result.tsx
    app/settings/page.tsx
    components/Copy.tsx  components/ErrorLine.tsx
  tests/
    chains.test.ts keys.test.ts recipient.test.ts derive.test.ts scan.test.ts
    register.test.ts buildCalls.test.ts stores.test.ts
```

---

### Task 1: Scaffold `web/` with chain config

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/next.config.ts`, `web/vitest.config.ts`, `web/.env.example`, `web/.gitignore`
- Create: `web/src/config/chains.ts`
- Test: `web/tests/chains.test.ts`

**Interfaces:**
- Produces: `getChainConfig(env?: Record<string,string|undefined>): ChainConfig` where
  ```ts
  type ChainConfig = {
    chain: Chain;                 // viem chain object
    chainId: 8453 | 84532;
    rpcUrl: string;
    mainnetRpcUrl: string;
    announcer: `0x${string}`;
    registry: `0x${string}`;
    usdc: `0x${string}`;
    usdcDecimals: 6;
    explorer: string;             // base URL, no trailing slash
    scanStartBlock: bigint;       // SDK ERC5564_StartBlocks for the chain
    scanChunkSize: bigint;        // default 2000n
    relayUrl: string;             // default '/api/relay'
    stealthDisperse?: `0x${string}`; // teammate contract, optional
  }
  ```

- [ ] **Step 1: Scaffold the app**

```bash
cd ~/Documents/GitHub/soapay
pnpm dlx create-next-app@latest web --ts --app --src-dir --no-tailwind --no-eslint --import-alias "@/*" --use-pnpm --skip-install
cd web
pnpm add viem@^2.56 wagmi@^2 @tanstack/react-query@^5 @scopelift/stealth-address-sdk@1.0.0-beta.5
pnpm add -D vitest@^3 @types/node
```

If `create-next-app` prompts for Turbopack or React Compiler, answer no.

- [ ] **Step 2: Add vitest config and scripts**

`web/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
});
```

In `web/package.json` scripts, add `"test": "vitest run"` and `"test:watch": "vitest"`. Keep `dev`, `build`, `start`. Set `"dev": "next dev -p 3100"` so it does not collide with other local apps.

- [ ] **Step 3: Write `.env.example` and gitignore**

`web/.env.example`:
```
# Payroll chain: 84532 = Base Sepolia (dev), 8453 = Base
NEXT_PUBLIC_CHAIN_ID=84532
NEXT_PUBLIC_RPC_URL=https://sepolia.base.org
# ENS resolution always starts on Ethereum L1
NEXT_PUBLIC_MAINNET_RPC_URL=https://ethereum-rpc.publicnode.com
# Optional overrides
# NEXT_PUBLIC_USDC_ADDRESS=
# NEXT_PUBLIC_SCAN_CHUNK_SIZE=2000
# NEXT_PUBLIC_RELAY_URL=/api/relay
# NEXT_PUBLIC_STEALTH_DISPERSE_ADDRESS=

# Server only. Dev key funded with a little testnet ETH. Never a real key.
RELAYER_PRIVATE_KEY=
```

Ensure `web/.gitignore` contains `.env*.local` and `.env` (create-next-app adds `.env*` handling; verify with `cat web/.gitignore | grep env`).

- [ ] **Step 4: Write the failing test**

`web/tests/chains.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getChainConfig } from '@/config/chains';

describe('getChainConfig', () => {
  it('defaults to Base Sepolia with SDK addresses', () => {
    const c = getChainConfig({});
    expect(c.chainId).toBe(84532);
    expect(c.announcer).toBe('0x55649E01B5Df198D18D95b5cc5051630cfD45564');
    expect(c.registry).toBe('0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538');
    expect(c.usdc).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
    expect(c.scanStartBlock).toBe(7552655n);
    expect(c.scanChunkSize).toBe(2000n);
    expect(c.relayUrl).toBe('/api/relay');
    expect(c.explorer).toBe('https://sepolia.basescan.org');
  });

  it('selects Base mainnet', () => {
    const c = getChainConfig({ NEXT_PUBLIC_CHAIN_ID: '8453' });
    expect(c.chainId).toBe(8453);
    expect(c.usdc).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(c.scanStartBlock).toBe(15502414n);
    expect(c.explorer).toBe('https://basescan.org');
  });

  it('honours overrides', () => {
    const c = getChainConfig({
      NEXT_PUBLIC_USDC_ADDRESS: '0x0000000000000000000000000000000000000001',
      NEXT_PUBLIC_SCAN_CHUNK_SIZE: '500',
      NEXT_PUBLIC_STEALTH_DISPERSE_ADDRESS: '0x0000000000000000000000000000000000000002',
    });
    expect(c.usdc).toBe('0x0000000000000000000000000000000000000001');
    expect(c.scanChunkSize).toBe(500n);
    expect(c.stealthDisperse).toBe('0x0000000000000000000000000000000000000002');
  });

  it('rejects unsupported chain ids', () => {
    expect(() => getChainConfig({ NEXT_PUBLIC_CHAIN_ID: '1' })).toThrow(/unsupported/i);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd web && pnpm test`
Expected: FAIL, cannot resolve `@/config/chains`.

- [ ] **Step 6: Implement `chains.ts`**

`web/src/config/chains.ts`:
```ts
import { base, baseSepolia, type Chain } from 'viem/chains';
import {
  ERC5564_CONTRACT_ADDRESS,
  ERC6538_CONTRACT_ADDRESS,
  ERC5564_StartBlocks,
} from '@scopelift/stealth-address-sdk';

export type SupportedChainId = 8453 | 84532;

export type ChainConfig = {
  chain: Chain;
  chainId: SupportedChainId;
  rpcUrl: string;
  mainnetRpcUrl: string;
  announcer: `0x${string}`;
  registry: `0x${string}`;
  usdc: `0x${string}`;
  usdcDecimals: 6;
  explorer: string;
  scanStartBlock: bigint;
  scanChunkSize: bigint;
  relayUrl: string;
  stealthDisperse?: `0x${string}`;
};

const PRESETS: Record<SupportedChainId, {
  chain: Chain; rpcUrl: string; usdc: `0x${string}`; explorer: string; startBlock: bigint;
}> = {
  84532: {
    chain: baseSepolia,
    rpcUrl: 'https://sepolia.base.org',
    // Circle USDC on Base Sepolia
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    explorer: 'https://sepolia.basescan.org',
    startBlock: BigInt(ERC5564_StartBlocks.BASE_SEPOLIA),
  },
  8453: {
    chain: base,
    rpcUrl: 'https://mainnet.base.org',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    explorer: 'https://basescan.org',
    startBlock: BigInt(ERC5564_StartBlocks.BASE),
  },
};

type Env = Record<string, string | undefined>;

export function getChainConfig(env: Env = process.env as Env): ChainConfig {
  const id = Number(env.NEXT_PUBLIC_CHAIN_ID ?? '84532');
  if (id !== 8453 && id !== 84532) {
    throw new Error(`Unsupported NEXT_PUBLIC_CHAIN_ID=${id}. Use 8453 or 84532.`);
  }
  const p = PRESETS[id];
  const disperse = env.NEXT_PUBLIC_STEALTH_DISPERSE_ADDRESS as `0x${string}` | undefined;
  return {
    chain: p.chain,
    chainId: id,
    rpcUrl: env.NEXT_PUBLIC_RPC_URL ?? p.rpcUrl,
    mainnetRpcUrl: env.NEXT_PUBLIC_MAINNET_RPC_URL ?? 'https://ethereum-rpc.publicnode.com',
    announcer: ERC5564_CONTRACT_ADDRESS,
    registry: ERC6538_CONTRACT_ADDRESS,
    usdc: (env.NEXT_PUBLIC_USDC_ADDRESS as `0x${string}` | undefined) ?? p.usdc,
    usdcDecimals: 6,
    explorer: p.explorer,
    scanStartBlock: p.startBlock,
    scanChunkSize: BigInt(env.NEXT_PUBLIC_SCAN_CHUNK_SIZE ?? '2000'),
    relayUrl: env.NEXT_PUBLIC_RELAY_URL ?? '/api/relay',
    stealthDisperse: disperse && disperse.length === 42 ? disperse : undefined,
  };
}

/** Module-level config for client components. Reads NEXT_PUBLIC_* at build time. */
export const chainConfig = getChainConfig({
  NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
  NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
  NEXT_PUBLIC_MAINNET_RPC_URL: process.env.NEXT_PUBLIC_MAINNET_RPC_URL,
  NEXT_PUBLIC_USDC_ADDRESS: process.env.NEXT_PUBLIC_USDC_ADDRESS,
  NEXT_PUBLIC_SCAN_CHUNK_SIZE: process.env.NEXT_PUBLIC_SCAN_CHUNK_SIZE,
  NEXT_PUBLIC_RELAY_URL: process.env.NEXT_PUBLIC_RELAY_URL,
  NEXT_PUBLIC_STEALTH_DISPERSE_ADDRESS: process.env.NEXT_PUBLIC_STEALTH_DISPERSE_ADDRESS,
});
```

Note: Next.js inlines `process.env.NEXT_PUBLIC_X` only when written literally, hence the explicit object.

- [ ] **Step 7: Run tests**

Run: `cd web && pnpm test`
Expected: 4 passing.

- [ ] **Step 8: Verify the SDK imports work under Next**

Run: `cd web && cp .env.example .env.local && pnpm build 2>&1 | tail -20`
Expected: build succeeds. If it fails on ESM/`graphql-request` resolution, add to `next.config.ts`: `transpilePackages: ['@scopelift/stealth-address-sdk']` and retry. Record which was needed in `web/README.md`.

- [ ] **Step 9: Commit**

```bash
cd ~/Documents/GitHub/soapay
git add web
git commit -m "web: scaffold Next.js app with chain config

Chain, RPCs, contract addresses and scan parameters come from env with
Base Sepolia as the dev default. Announcer and Registry addresses are
imported from the ScopeLift SDK."
```

---

### Task 2: Key derivation from one signature

**Files:**
- Create: `web/src/lib/stealth/keys.ts`
- Test: `web/tests/keys.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const SIGN_MESSAGE: string;
  export type StealthKeys = {
    spendingPrivateKey: `0x${string}`; spendingPublicKey: `0x${string}`;
    viewingPrivateKey: `0x${string}`;  viewingPublicKey: `0x${string}`;
    registrantPrivateKey: `0x${string}`; registrant: `0x${string}`;
    stealthMetaAddress: `0x${string}`;      // 0x + 132 hex (66 bytes)
    stealthMetaAddressURI: string;          // 'st:eth:0x...'
  };
  export function deriveKeysFromSignature(signature: `0x${string}`): StealthKeys;
  export function metaAddressToURI(meta: `0x${string}`): string;
  ```

- [ ] **Step 1: Write the failing test**

`web/tests/keys.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { deriveKeysFromSignature, SIGN_MESSAGE, metaAddressToURI } from '@/lib/stealth/keys';

async function sig() {
  const acct = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
  return acct.signMessage({ message: SIGN_MESSAGE });
}

describe('deriveKeysFromSignature', () => {
  it('is deterministic for the same signature', async () => {
    const s = await sig();
    const a = deriveKeysFromSignature(s);
    const b = deriveKeysFromSignature(s);
    expect(a).toEqual(b);
  });

  it('produces a 66-byte meta-address and matching URI', async () => {
    const k = deriveKeysFromSignature(await sig());
    expect(k.stealthMetaAddress).toMatch(/^0x[0-9a-f]{132}$/i);
    expect(k.stealthMetaAddressURI).toBe(`st:eth:${k.stealthMetaAddress}`);
    expect(metaAddressToURI(k.stealthMetaAddress)).toBe(k.stealthMetaAddressURI);
  });

  it('registrant differs from the signer and from the stealth keys', async () => {
    const s = await sig();
    const k = deriveKeysFromSignature(s);
    const signer = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d').address;
    expect(k.registrant).not.toBe(signer);
    expect(k.registrantPrivateKey).not.toBe(k.spendingPrivateKey);
    expect(k.registrantPrivateKey).not.toBe(k.viewingPrivateKey);
    expect(privateKeyToAccount(k.registrantPrivateKey).address).toBe(k.registrant);
  });

  it('different signers give different keys', async () => {
    const other = privateKeyToAccount(generatePrivateKey());
    const s2 = await other.signMessage({ message: SIGN_MESSAGE });
    expect(deriveKeysFromSignature(await sig()).stealthMetaAddress)
      .not.toBe(deriveKeysFromSignature(s2).stealthMetaAddress);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test tests/keys.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`web/src/lib/stealth/keys.ts`:
```ts
import { keccak256, concat, stringToHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { generateKeysFromSignature, generateStealthMetaAddressFromKeys } from '@scopelift/stealth-address-sdk';

/** Fixed text. Changing it changes every user's keys. */
export const SIGN_MESSAGE =
  'Soapay stealth keys v1\n\nSign to derive your private stealth keys. Only sign this inside Soapay. This signature never goes on-chain.';

export type StealthKeys = {
  spendingPrivateKey: Hex;
  spendingPublicKey: Hex;
  viewingPrivateKey: Hex;
  viewingPublicKey: Hex;
  registrantPrivateKey: Hex;
  registrant: Hex;
  stealthMetaAddress: Hex;
  stealthMetaAddressURI: string;
};

export function metaAddressToURI(meta: Hex): string {
  return `st:eth:${meta}`;
}

export function deriveKeysFromSignature(signature: Hex): StealthKeys {
  const k = generateKeysFromSignature(signature);
  const stealthMetaAddress = generateStealthMetaAddressFromKeys({
    spendingPublicKey: k.spendingPublicKey,
    viewingPublicKey: k.viewingPublicKey,
  });
  // Throwaway registrant, domain-separated from the stealth keys, recoverable from the same signature.
  const registrantPrivateKey = keccak256(concat([signature, stringToHex('soapay/registrant/v1')]));
  const registrant = privateKeyToAccount(registrantPrivateKey).address;
  return {
    ...k,
    registrantPrivateKey,
    registrant,
    stealthMetaAddress,
    stealthMetaAddressURI: metaAddressToURI(stealthMetaAddress),
  };
}
```

- [ ] **Step 4: Run tests**

Run: `cd web && pnpm test tests/keys.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/stealth/keys.ts web/tests/keys.test.ts
git commit -m "web: derive stealth and registrant keys from one signature"
```

---

### Task 3: Recipient input parsing and resolution with pins

**Files:**
- Create: `web/src/lib/stealth/recipient.ts`
- Test: `web/tests/recipient.test.ts`

**Interfaces:**
- Consumes: `metaAddressToURI` from Task 2.
- Produces:
  ```ts
  export type RecipientKind = 'ens' | 'registrant' | 'meta';
  export type ParsedRecipient =
    | { kind: 'ens'; name: string }
    | { kind: 'registrant'; address: `0x${string}` }
    | { kind: 'meta'; metaAddress: `0x${string}` };
  export function parseRecipient(input: string): ParsedRecipient;   // throws Error with a user-facing message
  export function parseAmount(input: string, decimals: number): bigint; // throws on bad input

  export type Pin = { registrant?: `0x${string}`; metaAddress: `0x${string}`; pinnedAt: number };
  export type Resolved =
    | { status: 'ok'; input: string; registrant?: `0x${string}`; metaAddress: `0x${string}` }
    | { status: 'changed'; input: string; registrant?: `0x${string}`; metaAddress: `0x${string}`; pinned: `0x${string}` }
    | { status: 'error'; input: string; message: string };

  export type ResolveDeps = {
    getEnsAddress: (name: string) => Promise<`0x${string}` | null>;
    getRegistryMeta: (registrant: `0x${string}`) => Promise<`0x${string}`>; // '0x' when empty
    pin?: Pin;
  };
  export async function resolveRecipient(input: string, deps: ResolveDeps): Promise<Resolved>;

  export type BatchLine = { input: string; amountText: string; amount: bigint };
  export function parseBatchText(text: string, decimals: number, maxRows: number):
    { lines: BatchLine[]; errors: { line: number; message: string }[] };
  ```

- [ ] **Step 1: Write the failing test**

`web/tests/recipient.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { generateRandomStealthMetaAddress } from '@scopelift/stealth-address-sdk';
import { parseRecipient, parseAmount, resolveRecipient, parseBatchText } from '@/lib/stealth/recipient';

const meta = generateRandomStealthMetaAddress().stealthMetaAddress;
const REG = '0x1111111111111111111111111111111111111111' as const;

describe('parseRecipient', () => {
  it('detects ENS, registrant and meta inputs', () => {
    expect(parseRecipient(' Alice.ETH ')).toEqual({ kind: 'ens', name: 'alice.eth' });
    expect(parseRecipient('bob.base.eth')).toEqual({ kind: 'ens', name: 'bob.base.eth' });
    expect(parseRecipient(REG)).toEqual({ kind: 'registrant', address: REG });
    expect(parseRecipient(`st:eth:${meta}`)).toEqual({ kind: 'meta', metaAddress: meta });
  });
  it('rejects garbage', () => {
    expect(() => parseRecipient('hello')).toThrow(/not a name, address or meta-address/i);
    expect(() => parseRecipient('st:eth:0x1234')).toThrow(/meta-address/i);
    expect(() => parseRecipient('0x12')).toThrow();
  });
});

describe('parseAmount', () => {
  it('parses USDC amounts', () => {
    expect(parseAmount('500', 6)).toBe(500_000_000n);
    expect(parseAmount('0.5', 6)).toBe(500_000n);
  });
  it('rejects too many decimals, zero, negative, junk', () => {
    expect(() => parseAmount('1.1234567', 6)).toThrow(/decimals/i);
    expect(() => parseAmount('0', 6)).toThrow(/greater than zero/i);
    expect(() => parseAmount('-1', 6)).toThrow();
    expect(() => parseAmount('abc', 6)).toThrow();
  });
});

describe('resolveRecipient', () => {
  const deps = {
    getEnsAddress: async (n: string) => (n === 'alice.eth' ? REG : null),
    getRegistryMeta: async (r: `0x${string}`) => (r === REG ? meta : '0x'),
  };
  it('resolves a name through the registry', async () => {
    const r = await resolveRecipient('alice.eth', deps);
    expect(r).toEqual({ status: 'ok', input: 'alice.eth', registrant: REG, metaAddress: meta });
  });
  it('resolves a raw meta-address without network', async () => {
    const r = await resolveRecipient(`st:eth:${meta}`, { ...deps, getEnsAddress: async () => { throw new Error('no'); } });
    expect(r.status).toBe('ok');
  });
  it('errors on unresolved name and on empty registry', async () => {
    expect((await resolveRecipient('nobody.eth', deps)).status).toBe('error');
    const r = await resolveRecipient('0x2222222222222222222222222222222222222222', deps);
    expect(r).toMatchObject({ status: 'error', message: expect.stringMatching(/no stealth meta-address registered/i) });
  });
  it('flags a changed meta-address against the pin', async () => {
    const other = generateRandomStealthMetaAddress().stealthMetaAddress;
    const r = await resolveRecipient('alice.eth', { ...deps, pin: { metaAddress: other, pinnedAt: 1 } });
    expect(r).toMatchObject({ status: 'changed', pinned: other, metaAddress: meta });
  });
  it('is ok when pin matches', async () => {
    const r = await resolveRecipient('alice.eth', { ...deps, pin: { metaAddress: meta, pinnedAt: 1 } });
    expect(r.status).toBe('ok');
  });
});

describe('parseBatchText', () => {
  it('parses lines, skips blanks, reports bad lines with numbers', () => {
    const { lines, errors } = parseBatchText(`alice.eth, 500\n\n${REG},0.25\nbad line\nbob.eth, 1.1234567`, 6, 400);
    expect(lines.map(l => l.amount)).toEqual([500_000_000n, 250_000n]);
    expect(errors.map(e => e.line)).toEqual([4, 5]);
  });
  it('caps rows', () => {
    const text = Array.from({ length: 401 }, () => `${REG}, 1`).join('\n');
    const { errors } = parseBatchText(text, 6, 400);
    expect(errors.some(e => /at most 400/i.test(e.message))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test tests/recipient.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`web/src/lib/stealth/recipient.ts`:
```ts
import { isAddress, getAddress, parseUnits, type Hex } from 'viem';
import { parseKeysFromStealthMetaAddress, VALID_SCHEME_ID } from '@scopelift/stealth-address-sdk';

export type ParsedRecipient =
  | { kind: 'ens'; name: string }
  | { kind: 'registrant'; address: Hex }
  | { kind: 'meta'; metaAddress: Hex };

const META_RE = /^st:eth:(0x[0-9a-fA-F]{132})$/;

export function parseRecipient(raw: string): ParsedRecipient {
  const input = raw.trim();
  const m = META_RE.exec(input);
  if (m) {
    const metaAddress = m[1].toLowerCase() as Hex;
    try {
      parseKeysFromStealthMetaAddress({ stealthMetaAddress: metaAddress, schemeId: VALID_SCHEME_ID.SCHEME_ID_1 });
    } catch {
      throw new Error('Invalid stealth meta-address: keys are not valid compressed public keys');
    }
    return { kind: 'meta', metaAddress };
  }
  if (input.startsWith('st:')) throw new Error('Invalid stealth meta-address: expected st:eth:0x followed by 132 hex characters');
  if (input.startsWith('0x')) {
    if (!isAddress(input)) throw new Error('Invalid address');
    return { kind: 'registrant', address: getAddress(input) };
  }
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(input)) {
    return { kind: 'ens', name: input.toLowerCase() };
  }
  throw new Error('Not a name, address or meta-address');
}

export function parseAmount(raw: string, decimals: number): bigint {
  const s = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('Amount must be a positive number');
  const frac = s.split('.')[1] ?? '';
  if (frac.length > decimals) throw new Error(`Amount has more than ${decimals} decimals`);
  const v = parseUnits(s, decimals);
  if (v <= 0n) throw new Error('Amount must be greater than zero');
  return v;
}

export type Pin = { registrant?: Hex; metaAddress: Hex; pinnedAt: number };

export type Resolved =
  | { status: 'ok'; input: string; registrant?: Hex; metaAddress: Hex }
  | { status: 'changed'; input: string; registrant?: Hex; metaAddress: Hex; pinned: Hex }
  | { status: 'error'; input: string; message: string };

export type ResolveDeps = {
  getEnsAddress: (name: string) => Promise<Hex | null>;
  getRegistryMeta: (registrant: Hex) => Promise<Hex>;
  pin?: Pin;
};

export async function resolveRecipient(rawInput: string, deps: ResolveDeps): Promise<Resolved> {
  const input = rawInput.trim();
  let parsed: ParsedRecipient;
  try {
    parsed = parseRecipient(input);
  } catch (e) {
    return { status: 'error', input, message: (e as Error).message };
  }
  try {
    let registrant: Hex | undefined;
    let metaAddress: Hex;
    if (parsed.kind === 'meta') {
      metaAddress = parsed.metaAddress;
    } else {
      if (parsed.kind === 'ens') {
        const addr = await deps.getEnsAddress(parsed.name);
        if (!addr) return { status: 'error', input, message: `Name ${parsed.name} does not resolve to an address` };
        registrant = addr;
      } else {
        registrant = parsed.address;
      }
      const meta = await deps.getRegistryMeta(registrant);
      if (!meta || meta === '0x' || meta.length !== 134) {
        return { status: 'error', input, message: `No stealth meta-address registered for ${registrant}` };
      }
      metaAddress = meta.toLowerCase() as Hex;
    }
    if (deps.pin && deps.pin.metaAddress.toLowerCase() !== metaAddress) {
      return { status: 'changed', input, registrant, metaAddress, pinned: deps.pin.metaAddress };
    }
    return { status: 'ok', input, registrant, metaAddress };
  } catch (e) {
    return { status: 'error', input, message: `Lookup failed: ${(e as Error).message}` };
  }
}

export type BatchLine = { input: string; amountText: string; amount: bigint };

export function parseBatchText(text: string, decimals: number, maxRows: number) {
  const lines: BatchLine[] = [];
  const errors: { line: number; message: string }[] = [];
  const rows = text.split(/\r?\n/);
  rows.forEach((row, i) => {
    if (!row.trim()) return;
    const n = i + 1;
    const parts = row.split(',').map(s => s.trim());
    if (parts.length !== 2) { errors.push({ line: n, message: 'Expected "recipient, amount"' }); return; }
    const [input, amountText] = parts;
    try {
      parseRecipient(input);
      const amount = parseAmount(amountText, decimals);
      lines.push({ input, amountText, amount });
    } catch (e) {
      errors.push({ line: n, message: (e as Error).message });
    }
  });
  if (lines.length > maxRows) errors.push({ line: 0, message: `At most ${maxRows} rows per run` });
  return { lines, errors };
}
```

- [ ] **Step 4: Run tests**

Run: `cd web && pnpm test tests/recipient.test.ts`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/stealth/recipient.ts web/tests/recipient.test.ts
git commit -m "web: parse and resolve recipients with meta-address pinning"
```

---

### Task 4: Per-row derivation, ordering, metadata

**Files:**
- Create: `web/src/lib/stealth/derive.ts`
- Test: `web/tests/derive.test.ts`

**Interfaces:**
- Consumes: `metaAddressToURI` (Task 2).
- Produces:
  ```ts
  export type PlannedRow = {
    input: string; metaAddress: `0x${string}`; amount: bigint;
    stealthAddress: `0x${string}`; ephemeralPublicKey: `0x${string}`; viewTag: `0x${string}`; metadata: `0x${string}`;
  };
  export function deriveRows(rows: { input: string; metaAddress: `0x${string}`; amount: bigint }[], token: `0x${string}`): PlannedRow[];
  // returns rows sorted strictly ascending by stealthAddress; throws DuplicateStealthAddressError on collision
  export class DuplicateStealthAddressError extends Error {}
  ```

- [ ] **Step 1: Write the failing test**

`web/tests/derive.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { generateRandomStealthMetaAddress, checkStealthAddress, parseMetadata, VALID_SCHEME_ID } from '@scopelift/stealth-address-sdk';
import { deriveRows } from '@/lib/stealth/derive';

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;

describe('deriveRows', () => {
  it('derives an address the recipient can recognise, with ERC-20 metadata', () => {
    const r = generateRandomStealthMetaAddress();
    const [row] = deriveRows([{ input: 'x', metaAddress: r.stealthMetaAddress, amount: 1_000_000n }], USDC);
    expect(checkStealthAddress({
      userStealthAddress: row.stealthAddress,
      viewTag: row.viewTag,
      ephemeralPublicKey: row.ephemeralPublicKey,
      spendingPublicKey: r.spendingPublicKey,
      viewingPrivateKey: r.viewingPrivateKey,
      schemeId: VALID_SCHEME_ID.SCHEME_ID_1,
    })).toBe(true);
    const md = parseMetadata(row.metadata);
    expect(md.viewTag.toLowerCase()).toBe(row.viewTag.toLowerCase());
    expect(md.contractAddress.toLowerCase()).toBe(USDC.toLowerCase());
    expect(BigInt(md.amount)).toBe(1_000_000n);
    expect(row.metadata.length).toBe(2 + 57 * 2);
  });

  it('gives a fresh address each call for the same recipient', () => {
    const r = generateRandomStealthMetaAddress();
    const a = deriveRows([{ input: 'x', metaAddress: r.stealthMetaAddress, amount: 1n }], USDC)[0];
    const b = deriveRows([{ input: 'x', metaAddress: r.stealthMetaAddress, amount: 1n }], USDC)[0];
    expect(a.stealthAddress).not.toBe(b.stealthAddress);
  });

  it('sorts strictly ascending by address', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      input: `r${i}`, metaAddress: generateRandomStealthMetaAddress().stealthMetaAddress, amount: 1n,
    }));
    const out = deriveRows(rows, USDC);
    for (let i = 1; i < out.length; i++) {
      expect(BigInt(out[i].stealthAddress) > BigInt(out[i - 1].stealthAddress)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test tests/derive.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`web/src/lib/stealth/derive.ts`:
```ts
import type { Hex } from 'viem';
import { generateStealthAddress, buildMetadataForERC20, VALID_SCHEME_ID } from '@scopelift/stealth-address-sdk';
import { metaAddressToURI } from './keys';

export type PlannedRow = {
  input: string;
  metaAddress: Hex;
  amount: bigint;
  stealthAddress: Hex;
  ephemeralPublicKey: Hex;
  viewTag: Hex;
  metadata: Hex;
};

export class DuplicateStealthAddressError extends Error {
  constructor(addr: string) { super(`Duplicate stealth address in batch: ${addr}. Regenerate and retry.`); }
}

export function deriveRows(
  rows: { input: string; metaAddress: Hex; amount: bigint }[],
  token: Hex,
): PlannedRow[] {
  const planned = rows.map((r) => {
    const g = generateStealthAddress({
      stealthMetaAddressURI: metaAddressToURI(r.metaAddress),
      schemeId: VALID_SCHEME_ID.SCHEME_ID_1,
    });
    const metadata = buildMetadataForERC20({ viewTag: g.viewTag, tokenAddress: token, amount: r.amount });
    return { ...r, stealthAddress: g.stealthAddress, ephemeralPublicKey: g.ephemeralPublicKey, viewTag: g.viewTag, metadata };
  });
  planned.sort((a, b) => (BigInt(a.stealthAddress) < BigInt(b.stealthAddress) ? -1 : 1));
  for (let i = 1; i < planned.length; i++) {
    if (planned[i].stealthAddress.toLowerCase() === planned[i - 1].stealthAddress.toLowerCase()) {
      throw new DuplicateStealthAddressError(planned[i].stealthAddress);
    }
  }
  return planned;
}
```

- [ ] **Step 4: Run tests**

Run: `cd web && pnpm test tests/derive.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/stealth/derive.ts web/tests/derive.test.ts
git commit -m "web: derive per-row stealth addresses with ERC-20 metadata, sorted ascending"
```

---

### Task 5: Bounded scanner

**Files:**
- Create: `web/src/lib/stealth/scan.ts`
- Test: `web/tests/scan.test.ts`

**Interfaces:**
- Consumes: `StealthKeys` (Task 2), `PlannedRow` shape for fixtures (Task 4).
- Produces:
  ```ts
  export type LedgerEntry = {
    stealthAddress: `0x${string}`; ephemeralPublicKey: `0x${string}`; viewTag: `0x${string}`;
    caller: `0x${string}`; txHash: `0x${string}`; blockNumber: string;   // bigint as string for JSON
    token?: `0x${string}`; amount?: string; metadata: `0x${string}`;
  };
  export type ScanDeps = {
    getLogs: (fromBlock: bigint, toBlock: bigint) => Promise<AnnouncementLog[]>;  // wraps SDK getAnnouncements
    latestBlock: () => Promise<bigint>;
  };
  export async function scanRange(opts: {
    keys: Pick<StealthKeys,'spendingPublicKey'|'viewingPrivateKey'>;
    fromBlock: bigint; toBlock?: bigint; chunkSize: bigint; deps: ScanDeps;
    onProgress?: (scannedTo: bigint, total: bigint) => void;
  }): Promise<{ entries: LedgerEntry[]; scannedTo: bigint }>;
  export function mergeLedger(existing: LedgerEntry[], incoming: LedgerEntry[]): LedgerEntry[]; // dedupe by txHash+stealthAddress, sorted by block asc
  export function decodeErc20Metadata(metadata: `0x${string}`): { token: `0x${string}`; amount: bigint } | null;
  export function makeGetLogs(publicClient: PublicClient, announcer: `0x${string}`): ScanDeps['getLogs'];
  ```

- [ ] **Step 1: Write the failing test**

`web/tests/scan.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { generateRandomStealthMetaAddress, type AnnouncementLog } from '@scopelift/stealth-address-sdk';
import { deriveRows } from '@/lib/stealth/derive';
import { scanRange, mergeLedger, decodeErc20Metadata } from '@/lib/stealth/scan';

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;

function log(row: { stealthAddress: `0x${string}`; ephemeralPublicKey: `0x${string}`; metadata: `0x${string}` }, block: bigint, tx: `0x${string}`): AnnouncementLog {
  return {
    schemeId: 1n, stealthAddress: row.stealthAddress, caller: '0x00000000000000000000000000000000000000aa',
    ephemeralPubKey: row.ephemeralPublicKey, metadata: row.metadata,
    blockNumber: block, transactionHash: tx, address: '0x55649E01B5Df198D18D95b5cc5051630cfD45564',
    blockHash: '0x00', data: '0x', logIndex: 0, removed: false, topics: [], transactionIndex: 0,
  } as unknown as AnnouncementLog;
}

describe('scanRange', () => {
  it('finds only my announcements, across chunks, and decodes amounts', async () => {
    const me = generateRandomStealthMetaAddress();
    const them = generateRandomStealthMetaAddress();
    const mine = deriveRows([{ input: 'a', metaAddress: me.stealthMetaAddress, amount: 5_000_000n }], USDC)[0];
    const theirs = deriveRows([{ input: 'b', metaAddress: them.stealthMetaAddress, amount: 1n }], USDC)[0];
    const logs = [log(theirs, 100n, '0x01'), log(mine, 2500n, '0x02')];
    const calls: [bigint, bigint][] = [];
    const { entries, scannedTo } = await scanRange({
      keys: { spendingPublicKey: me.spendingPublicKey, viewingPrivateKey: me.viewingPrivateKey },
      fromBlock: 0n, chunkSize: 1000n,
      deps: {
        latestBlock: async () => 3000n,
        getLogs: async (f, t) => { calls.push([f, t]); return logs.filter(l => l.blockNumber! >= f && l.blockNumber! <= t); },
      },
    });
    expect(calls).toEqual([[0n, 999n], [1000n, 1999n], [2000n, 2999n], [3000n, 3000n]]);
    expect(scannedTo).toBe(3000n);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ stealthAddress: mine.stealthAddress, txHash: '0x02', blockNumber: '2500', token: USDC.toLowerCase(), amount: '5000000' });
  });

  it('keeps a matching announcement whose metadata is not ERC-20 shaped', async () => {
    const me = generateRandomStealthMetaAddress();
    const mine = deriveRows([{ input: 'a', metaAddress: me.stealthMetaAddress, amount: 1n }], USDC)[0];
    const weird = { ...mine, metadata: mine.viewTag as `0x${string}` }; // 1 byte only
    const { entries } = await scanRange({
      keys: { spendingPublicKey: me.spendingPublicKey, viewingPrivateKey: me.viewingPrivateKey },
      fromBlock: 0n, toBlock: 10n, chunkSize: 100n,
      deps: { latestBlock: async () => 10n, getLogs: async () => [log(weird, 5n, '0x03')] },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].amount).toBeUndefined();
  });
});

describe('decodeErc20Metadata', () => {
  it('returns null for short metadata', () => {
    expect(decodeErc20Metadata('0xab')).toBeNull();
  });
});

describe('mergeLedger', () => {
  it('dedupes and sorts', () => {
    const a = { stealthAddress: '0x1', txHash: '0xa', blockNumber: '5' } as any;
    const b = { stealthAddress: '0x2', txHash: '0xb', blockNumber: '2' } as any;
    const out = mergeLedger([a], [a, b]);
    expect(out.map(e => e.txHash)).toEqual(['0xb', '0xa']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test tests/scan.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`web/src/lib/stealth/scan.ts`:
```ts
import type { Hex, PublicClient } from 'viem';
import {
  getAnnouncements, getAnnouncementsForUser, parseMetadata, VALID_SCHEME_ID,
  type AnnouncementLog,
} from '@scopelift/stealth-address-sdk';
import type { StealthKeys } from './keys';

export type LedgerEntry = {
  stealthAddress: Hex;
  ephemeralPublicKey: Hex;
  viewTag: Hex;
  caller: Hex;
  txHash: Hex;
  blockNumber: string;
  token?: Hex;
  amount?: string;
  metadata: Hex;
};

export type ScanDeps = {
  getLogs: (fromBlock: bigint, toBlock: bigint) => Promise<AnnouncementLog[]>;
  latestBlock: () => Promise<bigint>;
};

export function decodeErc20Metadata(metadata: Hex): { token: Hex; amount: bigint } | null {
  if (metadata.length !== 2 + 57 * 2) return null;
  try {
    const md = parseMetadata(metadata);
    return { token: md.contractAddress.toLowerCase() as Hex, amount: BigInt(md.amount) };
  } catch {
    return null;
  }
}

export function makeGetLogs(publicClient: PublicClient, announcer: Hex): ScanDeps['getLogs'] {
  return (fromBlock, toBlock) =>
    getAnnouncements({
      clientParams: { publicClient },
      ERC5564Address: announcer,
      args: { schemeId: BigInt(VALID_SCHEME_ID.SCHEME_ID_1) },
      fromBlock,
      toBlock,
    });
}

export async function scanRange(opts: {
  keys: Pick<StealthKeys, 'spendingPublicKey' | 'viewingPrivateKey'>;
  fromBlock: bigint;
  toBlock?: bigint;
  chunkSize: bigint;
  deps: ScanDeps;
  onProgress?: (scannedTo: bigint, total: bigint) => void;
}): Promise<{ entries: LedgerEntry[]; scannedTo: bigint }> {
  const end = opts.toBlock ?? (await opts.deps.latestBlock());
  const entries: LedgerEntry[] = [];
  let from = opts.fromBlock;
  while (from <= end) {
    const to = from + opts.chunkSize - 1n < end ? from + opts.chunkSize - 1n : end;
    const logs = await opts.deps.getLogs(from, to);
    if (logs.length) {
      const mine = await getAnnouncementsForUser({
        announcements: logs,
        spendingPublicKey: opts.keys.spendingPublicKey,
        viewingPrivateKey: opts.keys.viewingPrivateKey,
      });
      for (const l of mine) {
        const erc20 = decodeErc20Metadata(l.metadata);
        entries.push({
          stealthAddress: l.stealthAddress,
          ephemeralPublicKey: l.ephemeralPubKey,
          viewTag: l.metadata.slice(0, 4) as Hex,
          caller: l.caller,
          txHash: l.transactionHash as Hex,
          blockNumber: String(l.blockNumber),
          token: erc20?.token,
          amount: erc20 ? String(erc20.amount) : undefined,
          metadata: l.metadata,
        });
      }
    }
    opts.onProgress?.(to, end);
    from = to + 1n;
  }
  return { entries, scannedTo: end };
}

export function mergeLedger(existing: LedgerEntry[], incoming: LedgerEntry[]): LedgerEntry[] {
  const map = new Map<string, LedgerEntry>();
  for (const e of [...existing, ...incoming]) map.set(`${e.txHash}:${e.stealthAddress.toLowerCase()}`, e);
  return [...map.values()].sort((a, b) => (BigInt(a.blockNumber) < BigInt(b.blockNumber) ? -1 : 1));
}
```

- [ ] **Step 4: Run tests**

Run: `cd web && pnpm test tests/scan.test.ts`
Expected: 4 passing. If `getAnnouncementsForUser` is not a named export at the package root, import it from `@scopelift/stealth-address-sdk/dist/lib/actions/getAnnouncementsForUser/getAnnouncementsForUser.js` and note it in `web/README.md`.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/stealth/scan.ts web/tests/scan.test.ts
git commit -m "web: bounded announcement scanner with ERC-20 metadata decoding"
```

---

### Task 6: Registration payload and mock relayer

**Files:**
- Create: `web/src/lib/stealth/register.ts`
- Create: `web/src/app/api/relay/route.ts`
- Test: `web/tests/register.test.ts`

**Interfaces:**
- Consumes: `StealthKeys` (Task 2), `ChainConfig` (Task 1).
- Produces:
  ```ts
  export type RelayRequest = { registrant: `0x${string}`; schemeId: 1; stealthMetaAddress: `0x${string}`; signature: `0x${string}` };
  export type RelayResponse = { txHash: `0x${string}` } | { error: string };
  export async function signRegisterOnBehalf(opts: {
    keys: Pick<StealthKeys,'registrantPrivateKey'|'registrant'|'stealthMetaAddress'>;
    chainId: number; registry: `0x${string}`; nonce: bigint;
  }): Promise<RelayRequest>;                                   // pure, no network
  export async function readRegisteredMeta(publicClient: PublicClient, registry: `0x${string}`, registrant: `0x${string}`): Promise<`0x${string}`>; // '0x' if none
  export async function readNonce(publicClient: PublicClient, registry: `0x${string}`, registrant: `0x${string}`): Promise<bigint>;
  export async function submitToRelay(relayUrl: string, req: RelayRequest): Promise<`0x${string}`>; // throws with server error text
  ```
- Relay route: `POST /api/relay` body `RelayRequest` -> `200 {txHash}` or `4xx/5xx {error}`.

- [ ] **Step 1: Write the failing test**

`web/tests/register.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { verifyTypedData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { deriveKeysFromSignature, SIGN_MESSAGE } from '@/lib/stealth/keys';
import { signRegisterOnBehalf } from '@/lib/stealth/register';

describe('signRegisterOnBehalf', () => {
  it('produces an EIP-712 signature the registry domain verifies', async () => {
    const wallet = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
    const keys = deriveKeysFromSignature(await wallet.signMessage({ message: SIGN_MESSAGE }));
    const registry = '0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538' as const;
    const req = await signRegisterOnBehalf({ keys, chainId: 84532, registry, nonce: 0n });
    expect(req.registrant).toBe(keys.registrant);
    expect(req.schemeId).toBe(1);
    expect(req.stealthMetaAddress).toBe(keys.stealthMetaAddress);
    const ok = await verifyTypedData({
      address: keys.registrant,
      domain: { name: 'ERC6538Registry', version: '1.0', chainId: 84532, verifyingContract: registry },
      types: { Erc6538RegistryEntry: [
        { name: 'schemeId', type: 'uint256' }, { name: 'stealthMetaAddress', type: 'bytes' }, { name: 'nonce', type: 'uint256' },
      ] },
      primaryType: 'Erc6538RegistryEntry',
      message: { schemeId: 1n, stealthMetaAddress: keys.stealthMetaAddress, nonce: 0n },
      signature: req.signature,
    });
    expect(ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test tests/register.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `register.ts`**

`web/src/lib/stealth/register.ts`:
```ts
import type { Hex, PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ERC6538RegistryAbi } from '@scopelift/stealth-address-sdk';
import type { StealthKeys } from './keys';

export type RelayRequest = { registrant: Hex; schemeId: 1; stealthMetaAddress: Hex; signature: Hex };
export type RelayResponse = { txHash: Hex } | { error: string };

export const REGISTRY_TYPES = {
  Erc6538RegistryEntry: [
    { name: 'schemeId', type: 'uint256' },
    { name: 'stealthMetaAddress', type: 'bytes' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

export async function signRegisterOnBehalf(opts: {
  keys: Pick<StealthKeys, 'registrantPrivateKey' | 'registrant' | 'stealthMetaAddress'>;
  chainId: number;
  registry: Hex;
  nonce: bigint;
}): Promise<RelayRequest> {
  const account = privateKeyToAccount(opts.keys.registrantPrivateKey);
  const signature = await account.signTypedData({
    domain: { name: 'ERC6538Registry', version: '1.0', chainId: opts.chainId, verifyingContract: opts.registry },
    types: REGISTRY_TYPES,
    primaryType: 'Erc6538RegistryEntry',
    message: { schemeId: 1n, stealthMetaAddress: opts.keys.stealthMetaAddress, nonce: opts.nonce },
  });
  return { registrant: opts.keys.registrant, schemeId: 1, stealthMetaAddress: opts.keys.stealthMetaAddress, signature };
}

export function readRegisteredMeta(publicClient: PublicClient, registry: Hex, registrant: Hex) {
  return publicClient.readContract({
    address: registry, abi: ERC6538RegistryAbi, functionName: 'stealthMetaAddressOf', args: [registrant, 1n],
  }) as Promise<Hex>;
}

export function readNonce(publicClient: PublicClient, registry: Hex, registrant: Hex) {
  return publicClient.readContract({
    address: registry, abi: ERC6538RegistryAbi, functionName: 'nonceOf', args: [registrant],
  }) as Promise<bigint>;
}

export async function submitToRelay(relayUrl: string, req: RelayRequest): Promise<Hex> {
  const res = await fetch(relayUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
  const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as RelayResponse;
  if (!res.ok || 'error' in body) throw new Error('error' in body ? body.error : `Relay failed: HTTP ${res.status}`);
  return body.txHash;
}
```

- [ ] **Step 4: Run tests**

Run: `cd web && pnpm test tests/register.test.ts`
Expected: 1 passing.

- [ ] **Step 5: Implement the relay route**

`web/src/app/api/relay/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { createWalletClient, createPublicClient, http, isAddress, isHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ERC6538RegistryAbi } from '@scopelift/stealth-address-sdk';
import { getChainConfig } from '@/config/chains';
import type { RelayRequest } from '@/lib/stealth/register';

export const runtime = 'nodejs';

/**
 * Mock relayer. Submits registerKeysOnBehalf from a dev key so the registrant
 * never needs ETH and the employee's wallet never sends a public transaction.
 * The backend will replace this with a hosted relayer using the same request shape.
 */
export async function POST(req: Request) {
  const pk = process.env.RELAYER_PRIVATE_KEY;
  if (!pk || !isHex(pk) || pk.length !== 66) {
    return NextResponse.json({ error: 'Relayer not configured: set RELAYER_PRIVATE_KEY in web/.env.local' }, { status: 503 });
  }
  let body: RelayRequest;
  try { body = (await req.json()) as RelayRequest; } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!isAddress(body.registrant) || body.schemeId !== 1 || !isHex(body.stealthMetaAddress) || body.stealthMetaAddress.length !== 134 || !isHex(body.signature)) {
    return NextResponse.json({ error: 'Invalid relay request' }, { status: 400 });
  }
  const cfg = getChainConfig();
  const account = privateKeyToAccount(pk);
  const publicClient = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) });
  const wallet = createWalletClient({ account, chain: cfg.chain, transport: http(cfg.rpcUrl) });
  try {
    const { request } = await publicClient.simulateContract({
      account, address: cfg.registry, abi: ERC6538RegistryAbi, functionName: 'registerKeysOnBehalf',
      args: [body.registrant, 1n, body.signature, body.stealthMetaAddress],
    });
    const txHash = await wallet.writeContract(request);
    return NextResponse.json({ txHash });
  } catch (e) {
    const msg = (e as Error).message.split('\n')[0];
    return NextResponse.json({ error: `Relay submit failed: ${msg}` }, { status: 502 });
  }
}
```

- [ ] **Step 6: Smoke the route**

Run: `cd web && pnpm dev` in one terminal, then:
```bash
curl -s -X POST localhost:3100/api/relay -H 'content-type: application/json' -d '{}' ; echo
```
Expected with no key: `{"error":"Relayer not configured: ..."}` and HTTP 503. Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/stealth/register.ts web/src/app/api/relay/route.ts web/tests/register.test.ts
git commit -m "web: registrant EIP-712 signing and mock relayer route"
```

---

### Task 7: Batch calls and EIP-5792 sender

**Files:**
- Create: `web/src/lib/batch/types.ts`, `web/src/lib/batch/buildCalls.ts`, `web/src/lib/batch/sendCalls.ts`
- Test: `web/tests/buildCalls.test.ts`

**Interfaces:**
- Consumes: `PlannedRow` (Task 4), `ChainConfig` (Task 1).
- Produces:
  ```ts
  // types.ts
  export type BatchCall = { to: `0x${string}`; data: `0x${string}` };
  export type BatchMode = 'atomic' | 'sequential';
  export type BatchProgress = { step: string; done: number; total: number };
  export type BatchResult = { mode: BatchMode; txHashes: `0x${string}`[] };
  export interface BatchSender {
    detect(): Promise<BatchMode>;
    send(calls: BatchCall[], onProgress: (p: BatchProgress) => void): Promise<BatchResult>;
  }
  // buildCalls.ts
  export function buildBatchCalls(rows: PlannedRow[], cfg: Pick<ChainConfig,'usdc'|'announcer'>): BatchCall[];
  // sendCalls.ts
  export function createWalletBatchSender(walletClient: WalletClient, publicClient: PublicClient, chainId: number): BatchSender;
  ```

- [ ] **Step 1: Write the failing test**

`web/tests/buildCalls.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { decodeFunctionData, erc20Abi } from 'viem';
import { ERC5564AnnouncerAbi, generateRandomStealthMetaAddress } from '@scopelift/stealth-address-sdk';
import { deriveRows } from '@/lib/stealth/derive';
import { buildBatchCalls } from '@/lib/batch/buildCalls';

const cfg = { usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', announcer: '0x55649E01B5Df198D18D95b5cc5051630cfD45564' } as const;

describe('buildBatchCalls', () => {
  it('emits N transfers then N announces, matching rows', () => {
    const rows = deriveRows([
      { input: 'a', metaAddress: generateRandomStealthMetaAddress().stealthMetaAddress, amount: 7n },
      { input: 'b', metaAddress: generateRandomStealthMetaAddress().stealthMetaAddress, amount: 9n },
    ], cfg.usdc);
    const calls = buildBatchCalls(rows, cfg);
    expect(calls).toHaveLength(4);
    const t0 = decodeFunctionData({ abi: erc20Abi, data: calls[0].data });
    expect(calls[0].to).toBe(cfg.usdc);
    expect(t0.functionName).toBe('transfer');
    expect(t0.args).toEqual([rows[0].stealthAddress, 7n]);
    const a1 = decodeFunctionData({ abi: ERC5564AnnouncerAbi, data: calls[3].data });
    expect(calls[3].to).toBe(cfg.announcer);
    expect(a1.functionName).toBe('announce');
    expect(a1.args).toEqual([1n, rows[1].stealthAddress, rows[1].ephemeralPublicKey, rows[1].metadata]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test tests/buildCalls.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement types and buildCalls**

`web/src/lib/batch/types.ts`:
```ts
import type { Hex } from 'viem';

export type BatchCall = { to: Hex; data: Hex };
export type BatchMode = 'atomic' | 'sequential';
export type BatchProgress = { step: string; done: number; total: number };
export type BatchResult = { mode: BatchMode; txHashes: Hex[] };

export interface BatchSender {
  detect(): Promise<BatchMode>;
  send(calls: BatchCall[], onProgress: (p: BatchProgress) => void): Promise<BatchResult>;
}
```

`web/src/lib/batch/buildCalls.ts`:
```ts
import { encodeFunctionData, erc20Abi } from 'viem';
import { ERC5564AnnouncerAbi } from '@scopelift/stealth-address-sdk';
import type { PlannedRow } from '@/lib/stealth/derive';
import type { ChainConfig } from '@/config/chains';
import type { BatchCall } from './types';

export function buildBatchCalls(rows: PlannedRow[], cfg: Pick<ChainConfig, 'usdc' | 'announcer'>): BatchCall[] {
  const transfers: BatchCall[] = rows.map((r) => ({
    to: cfg.usdc,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [r.stealthAddress, r.amount] }),
  }));
  const announces: BatchCall[] = rows.map((r) => ({
    to: cfg.announcer,
    data: encodeFunctionData({
      abi: ERC5564AnnouncerAbi, functionName: 'announce',
      args: [1n, r.stealthAddress, r.ephemeralPublicKey, r.metadata],
    }),
  }));
  return [...transfers, ...announces];
}
```

- [ ] **Step 4: Run tests**

Run: `cd web && pnpm test tests/buildCalls.test.ts`
Expected: 1 passing.

- [ ] **Step 5: Implement the wallet sender**

`web/src/lib/batch/sendCalls.ts`:
```ts
import type { Hex, PublicClient, WalletClient } from 'viem';
import type { BatchCall, BatchMode, BatchProgress, BatchResult, BatchSender } from './types';

/**
 * EIP-5792 batch when the wallet supports atomic execution (7702-upgraded EOAs,
 * smart wallets). Otherwise sequential: all announces first (harmless if unpaid),
 * then transfers, each its own transaction.
 */
export function createWalletBatchSender(walletClient: WalletClient, publicClient: PublicClient, chainId: number): BatchSender {
  const account = walletClient.account!;

  async function detect(): Promise<BatchMode> {
    try {
      const caps = await walletClient.getCapabilities({ account, chainId });
      const status = (caps as any)?.atomic?.status ?? (caps as any)?.atomicBatch?.supported;
      return status === 'supported' || status === 'ready' || status === true ? 'atomic' : 'sequential';
    } catch {
      return 'sequential';
    }
  }

  async function sendAtomic(calls: BatchCall[], onProgress: (p: BatchProgress) => void): Promise<BatchResult> {
    onProgress({ step: 'Waiting for wallet signature', done: 0, total: 1 });
    const { id } = await walletClient.sendCalls({ account, chain: walletClient.chain, calls, forceAtomic: true });
    onProgress({ step: 'Waiting for confirmation', done: 0, total: 1 });
    const status = await walletClient.waitForCallsStatus({ id, timeout: 180_000 });
    if (status.status !== 'success') throw new Error(`Batch failed with status ${status.status}`);
    const txHashes = (status.receipts ?? []).map((r) => r.transactionHash as Hex);
    onProgress({ step: 'Confirmed', done: 1, total: 1 });
    return { mode: 'atomic', txHashes };
  }

  async function sendSequential(calls: BatchCall[], onProgress: (p: BatchProgress) => void): Promise<BatchResult> {
    // buildBatchCalls emits transfers first then announces; here announces go first.
    const half = calls.length / 2;
    const ordered = [...calls.slice(half), ...calls.slice(0, half)];
    const txHashes: Hex[] = [];
    for (let i = 0; i < ordered.length; i++) {
      onProgress({ step: i < half ? 'Announcing' : 'Paying', done: i, total: ordered.length });
      const hash = await walletClient.sendTransaction({ account, chain: walletClient.chain, to: ordered[i].to, data: ordered[i].data });
      await publicClient.waitForTransactionReceipt({ hash });
      txHashes.push(hash);
    }
    onProgress({ step: 'Confirmed', done: ordered.length, total: ordered.length });
    return { mode: 'sequential', txHashes };
  }

  return {
    detect,
    async send(calls, onProgress) {
      const mode = await detect();
      return mode === 'atomic' ? sendAtomic(calls, onProgress) : sendSequential(calls, onProgress);
    },
  };
}
```

- [ ] **Step 6: Typecheck**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: no errors. If `getCapabilities`/`sendCalls`/`waitForCallsStatus` are missing on `WalletClient`, viem is older than 2.29; run `pnpm add viem@latest` and retry.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/batch web/tests/buildCalls.test.ts
git commit -m "web: batch call builder and EIP-5792 sender with sequential fallback"
```

---

### Task 8: Local stores

**Files:**
- Create: `web/src/lib/store/recipientStore.ts`, `web/src/lib/store/senderStore.ts`
- Test: `web/tests/stores.test.ts`

**Interfaces:**
- Consumes: `LedgerEntry` (Task 5), `Pin` (Task 3).
- Produces:
  ```ts
  export type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
  export type RecipientState = {
    registrant: `0x${string}`; stealthMetaAddress: `0x${string}`;
    registrationBlock?: string; scanFromBlock?: string;   // user override
    lastScannedBlock?: string; ledger: LedgerEntry[]; ensName?: string; chainId: number;
  };
  export function createRecipientStore(storage: StorageLike, chainId: number): {
    get(): RecipientState | null; set(s: RecipientState): void; update(p: Partial<RecipientState>): void; clear(): void;
  };
  export type SenderState = { pins: Record<string, Pin>; draft: string };
  export function createSenderStore(storage: StorageLike): {
    get(): SenderState; setPin(input: string, pin: Pin): void; removePin(input: string): void; setDraft(t: string): void; clear(): void;
  };
  export function browserStorage(): StorageLike;  // window.localStorage or in-memory fallback
  ```
  Keys: `soapay:recipient:<chainId>` and `soapay:sender`.

- [ ] **Step 1: Write the failing test**

`web/tests/stores.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createRecipientStore, createSenderStore, type StorageLike } from '@/lib/store/recipientStore';

function mem(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k) };
}

describe('recipientStore', () => {
  it('round-trips and is namespaced by chain', () => {
    const s = mem();
    const a = createRecipientStore(s, 84532);
    const b = createRecipientStore(s, 8453);
    expect(a.get()).toBeNull();
    a.set({ registrant: '0x1', stealthMetaAddress: '0x2', ledger: [], chainId: 84532 } as any);
    a.update({ registrationBlock: '10' });
    expect(a.get()?.registrationBlock).toBe('10');
    expect(b.get()).toBeNull();
    a.clear();
    expect(a.get()).toBeNull();
  });
  it('never stores private keys even if passed', () => {
    const s = mem();
    const a = createRecipientStore(s, 84532);
    a.set({ registrant: '0x1', stealthMetaAddress: '0x2', ledger: [], chainId: 84532, spendingPrivateKey: '0xdead' } as any);
    expect(s.getItem('soapay:recipient:84532')).not.toContain('dead');
  });
});

describe('senderStore', () => {
  it('manages pins and draft', () => {
    const st = createSenderStore(mem());
    st.setPin('alice.eth', { metaAddress: '0xabc', pinnedAt: 1 });
    st.setDraft('alice.eth, 5');
    expect(st.get().pins['alice.eth'].metaAddress).toBe('0xabc');
    expect(st.get().draft).toBe('alice.eth, 5');
    st.removePin('alice.eth');
    expect(st.get().pins['alice.eth']).toBeUndefined();
  });
});
```

Note: `createSenderStore` is re-exported from `recipientStore.ts` for the test import; implement it in `senderStore.ts` and re-export.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test tests/stores.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`web/src/lib/store/recipientStore.ts`:
```ts
import type { Hex } from 'viem';
import type { LedgerEntry } from '@/lib/stealth/scan';
export { createSenderStore } from './senderStore';

export type StorageLike = {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
};

export type RecipientState = {
  registrant: Hex;
  stealthMetaAddress: Hex;
  registrationBlock?: string;
  scanFromBlock?: string;
  lastScannedBlock?: string;
  ledger: LedgerEntry[];
  ensName?: string;
  chainId: number;
};

const ALLOWED: (keyof RecipientState)[] = [
  'registrant', 'stealthMetaAddress', 'registrationBlock', 'scanFromBlock', 'lastScannedBlock', 'ledger', 'ensName', 'chainId',
];

function pick(s: RecipientState): RecipientState {
  const out = {} as RecipientState;
  for (const k of ALLOWED) if (s[k] !== undefined) (out as any)[k] = s[k];
  return out;
}

export function createRecipientStore(storage: StorageLike, chainId: number) {
  const key = `soapay:recipient:${chainId}`;
  const get = (): RecipientState | null => {
    const raw = storage.getItem(key);
    if (!raw) return null;
    try { return JSON.parse(raw) as RecipientState; } catch { return null; }
  };
  const set = (s: RecipientState) => storage.setItem(key, JSON.stringify(pick(s)));
  return {
    get,
    set,
    update(p: Partial<RecipientState>) {
      const cur = get();
      if (!cur) throw new Error('No recipient state to update');
      set({ ...cur, ...p });
    },
    clear() { storage.removeItem(key); },
  };
}

export function browserStorage(): StorageLike {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k) };
}
```

`web/src/lib/store/senderStore.ts`:
```ts
import type { Pin } from '@/lib/stealth/recipient';
import type { StorageLike } from './recipientStore';

export type SenderState = { pins: Record<string, Pin>; draft: string };
const KEY = 'soapay:sender';

export function createSenderStore(storage: StorageLike) {
  const get = (): SenderState => {
    const raw = storage.getItem(KEY);
    if (!raw) return { pins: {}, draft: '' };
    try { return { pins: {}, draft: '', ...(JSON.parse(raw) as Partial<SenderState>) }; } catch { return { pins: {}, draft: '' }; }
  };
  const save = (s: SenderState) => storage.setItem(KEY, JSON.stringify(s));
  return {
    get,
    setPin(input: string, pin: Pin) { const s = get(); s.pins[input.trim().toLowerCase()] = pin; save(s); },
    removePin(input: string) { const s = get(); delete s.pins[input.trim().toLowerCase()]; save(s); },
    setDraft(draft: string) { save({ ...get(), draft }); },
    clear() { storage.removeItem(KEY); },
  };
}
```

- [ ] **Step 4: Run all tests**

Run: `cd web && pnpm test`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/store web/tests/stores.test.ts
git commit -m "web: local stores for recipient state and sender pins, no secrets persisted"
```

---

### Task 9: Providers, layout, session keys

**Files:**
- Create: `web/src/config/wagmi.ts`, `web/src/app/providers.tsx`, `web/src/hooks/KeysProvider.tsx`, `web/src/components/Copy.tsx`, `web/src/components/ErrorLine.tsx`, `web/src/lib/format.ts`
- Modify: `web/src/app/layout.tsx`, `web/src/app/page.tsx`, `web/src/app/globals.css`

**Interfaces:**
- Produces:
  ```ts
  // hooks/KeysProvider.tsx
  export function KeysProvider({ children }): JSX.Element;
  export function useKeys(): { keys: StealthKeys | null; unlock(): Promise<StealthKeys>; lock(): void; busy: boolean; error?: string };
  // lib/format.ts
  export function short(hex: string, n = 6): string;           // 0x1234…abcd
  export function fmtUnits(v: bigint | string, decimals: number): string;
  export function explorerTx(cfg: ChainConfig, hash: string): string;
  export function explorerAddr(cfg: ChainConfig, addr: string): string;
  // components
  export function Copy({ value, label }): JSX.Element;         // button that copies, shows "copied"
  export function ErrorLine({ error }): JSX.Element | null;    // one red line
  ```

- [ ] **Step 1: wagmi config**

`web/src/config/wagmi.ts`:
```ts
import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { chainConfig } from './chains';

export const wagmiConfig = createConfig({
  chains: [chainConfig.chain],
  connectors: [injected()],
  transports: { [chainConfig.chain.id]: http(chainConfig.rpcUrl) },
  ssr: true,
});
```

- [ ] **Step 2: Providers and KeysProvider**

`web/src/app/providers.tsx`:
```tsx
'use client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { wagmiConfig } from '@/config/wagmi';
import { KeysProvider } from '@/hooks/KeysProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <KeysProvider>{children}</KeysProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
```

`web/src/hooks/KeysProvider.tsx`:
```tsx
'use client';
import { createContext, useContext, useState, useCallback } from 'react';
import { useSignMessage } from 'wagmi';
import { deriveKeysFromSignature, SIGN_MESSAGE, type StealthKeys } from '@/lib/stealth/keys';

type Ctx = { keys: StealthKeys | null; unlock(): Promise<StealthKeys>; lock(): void; busy: boolean; error?: string };
const KeysCtx = createContext<Ctx | null>(null);

/** Session-only. Keys live in React state, never in storage. */
export function KeysProvider({ children }: { children: React.ReactNode }) {
  const [keys, setKeys] = useState<StealthKeys | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { signMessageAsync } = useSignMessage();

  const unlock = useCallback(async () => {
    setBusy(true); setError(undefined);
    try {
      const sig = await signMessageAsync({ message: SIGN_MESSAGE });
      const k = deriveKeysFromSignature(sig);
      setKeys(k);
      return k;
    } catch (e) {
      setError((e as Error).message.split('\n')[0]);
      throw e;
    } finally { setBusy(false); }
  }, [signMessageAsync]);

  const lock = useCallback(() => setKeys(null), []);
  return <KeysCtx.Provider value={{ keys, unlock, lock, busy, error }}>{children}</KeysCtx.Provider>;
}

export function useKeys() {
  const c = useContext(KeysCtx);
  if (!c) throw new Error('useKeys outside KeysProvider');
  return c;
}
```

- [ ] **Step 3: Format helpers and small components**

`web/src/lib/format.ts`:
```ts
import { formatUnits } from 'viem';
import type { ChainConfig } from '@/config/chains';

export const short = (hex: string, n = 6) => (hex.length > 2 * n + 2 ? `${hex.slice(0, n + 2)}…${hex.slice(-n)}` : hex);
export const fmtUnits = (v: bigint | string, decimals: number) => formatUnits(typeof v === 'string' ? BigInt(v) : v, decimals);
export const explorerTx = (cfg: ChainConfig, hash: string) => `${cfg.explorer}/tx/${hash}`;
export const explorerAddr = (cfg: ChainConfig, addr: string) => `${cfg.explorer}/address/${addr}`;
```

`web/src/components/Copy.tsx`:
```tsx
'use client';
import { useState } from 'react';
export function Copy({ value, label = 'copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={async () => { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200); }}>
      {done ? 'copied' : label}
    </button>
  );
}
```

`web/src/components/ErrorLine.tsx`:
```tsx
export function ErrorLine({ error }: { error?: string | null }) {
  if (!error) return null;
  return <p role="alert" style={{ color: '#b00020' }}>{error}</p>;
}
```

- [ ] **Step 4: Layout, home redirect, CSS**

`web/src/app/layout.tsx`:
```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { Providers } from './providers';
import { chainConfig } from '@/config/chains';

export const metadata: Metadata = { title: 'Soapay' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <header>
            <strong>Soapay</strong>
            <nav>
              <Link href="/receive">Receive</Link>
              <Link href="/pay">Pay</Link>
              <Link href="/settings">Settings</Link>
            </nav>
            <span>{chainConfig.chain.name}</span>
          </header>
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  );
}
```

`web/src/app/page.tsx`:
```tsx
import { redirect } from 'next/navigation';
export default function Home() { redirect('/receive'); }
```

Replace `web/src/app/globals.css` with:
```css
body { font: 14px/1.4 system-ui, sans-serif; margin: 0; color: #111; background: #fff; }
header { display: flex; gap: 16px; align-items: center; padding: 8px 16px; border-bottom: 1px solid #ddd; }
nav a { margin-right: 12px; }
main { padding: 16px; max-width: 1100px; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; vertical-align: top; font-variant-numeric: tabular-nums; }
code { font-family: ui-monospace, monospace; word-break: break-all; }
textarea { width: 100%; min-height: 160px; font-family: ui-monospace, monospace; }
button { margin-right: 6px; }
.muted { color: #666; }
.ok { color: #0a7a2f; }
.warn { color: #9a6a00; }
```

Delete `web/src/app/page.module.css` if create-next-app made one.

- [ ] **Step 5: Run dev and check**

Run: `cd web && pnpm dev`, open `http://localhost:3100`.
Expected: redirects to `/receive` (404 for now is fine), header shows nav and "Base Sepolia". No console errors about providers. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "web: wagmi providers, session key context, layout and helpers"
```

---

### Task 10: Receive wizard

**Files:**
- Create: `web/src/app/receive/page.tsx`, `web/src/app/receive/Wizard.tsx`

**Interfaces:**
- Consumes: `useKeys` (Task 9), `signRegisterOnBehalf`, `readNonce`, `readRegisteredMeta`, `submitToRelay` (Task 6), `createRecipientStore`, `browserStorage` (Task 8), `chainConfig` (Task 1).
- Produces: `/receive` renders `Wizard` when the store has no state, else `Dashboard` (Task 11).

- [ ] **Step 1: Page switch**

`web/src/app/receive/page.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';
import { chainConfig } from '@/config/chains';
import { createRecipientStore, browserStorage, type RecipientState } from '@/lib/store/recipientStore';
import { Wizard } from './Wizard';
import { Dashboard } from './Dashboard';

export default function ReceivePage() {
  const [state, setState] = useState<RecipientState | null | undefined>(undefined);
  const store = createRecipientStore(browserStorage(), chainConfig.chainId);
  useEffect(() => { setState(store.get()); }, []);
  if (state === undefined) return <p className="muted">Loading…</p>;
  if (!state) return <Wizard onDone={() => setState(store.get())} />;
  return <Dashboard onReset={() => setState(null)} />;
}
```

- [ ] **Step 2: Wizard**

`web/src/app/receive/Wizard.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { useAccount, useConnect, usePublicClient } from 'wagmi';
import { createPublicClient, http, type Hex } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';
import { chainConfig } from '@/config/chains';
import { useKeys } from '@/hooks/KeysProvider';
import { signRegisterOnBehalf, readNonce, readRegisteredMeta, submitToRelay } from '@/lib/stealth/register';
import { createRecipientStore, browserStorage } from '@/lib/store/recipientStore';
import { Copy } from '@/components/Copy';
import { ErrorLine } from '@/components/ErrorLine';
import { explorerTx, short } from '@/lib/format';

type Step = 1 | 2 | 3 | 4;

export function Wizard({ onDone }: { onDone: () => void }) {
  const cfg = chainConfig;
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const publicClient = usePublicClient()!;
  const { keys, unlock, busy, error: keyError } = useKeys();
  const store = createRecipientStore(browserStorage(), cfg.chainId);

  const [step, setStep] = useState<Step>(1);
  const [err, setErr] = useState<string>();
  const [regTx, setRegTx] = useState<Hex>();
  const [regBlock, setRegBlock] = useState<bigint>();
  const [registered, setRegistered] = useState(false);
  const [name, setName] = useState('');
  const [nameStatus, setNameStatus] = useState<string>();
  const [linkedName, setLinkedName] = useState<string>();

  function exportBackup() {
    if (!keys) return;
    const blob = new Blob([JSON.stringify({
      warning: 'Private keys. Anyone with this file can spend your payments.',
      chainId: cfg.chainId, registrant: keys.registrant, stealthMetaAddress: keys.stealthMetaAddress,
      spendingPrivateKey: keys.spendingPrivateKey, viewingPrivateKey: keys.viewingPrivateKey, registrantPrivateKey: keys.registrantPrivateKey,
    }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `soapay-keys-${short(keys.registrant)}.json`; a.click();
    URL.revokeObjectURL(a.href);
  }

  async function checkRegistered() {
    if (!keys) return;
    const meta = await readRegisteredMeta(publicClient, cfg.registry, keys.registrant);
    const ok = meta.toLowerCase() === keys.stealthMetaAddress.toLowerCase();
    setRegistered(ok);
    return ok;
  }

  async function register() {
    if (!keys) return;
    setErr(undefined);
    try {
      if (await checkRegistered()) return;
      const nonce = await readNonce(publicClient, cfg.registry, keys.registrant);
      const req = await signRegisterOnBehalf({ keys, chainId: cfg.chainId, registry: cfg.registry, nonce });
      const tx = await submitToRelay(cfg.relayUrl, req);
      setRegTx(tx);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      setRegBlock(receipt.blockNumber);
      if (!(await checkRegistered())) throw new Error('Transaction confirmed but registry does not show the meta-address');
    } catch (e) { setErr((e as Error).message.split('\n')[0]); }
  }

  async function checkName() {
    setNameStatus(undefined); setErr(undefined);
    try {
      const n = normalize(name.trim());
      const l1 = createPublicClient({ chain: mainnet, transport: http(cfg.mainnetRpcUrl) });
      const addr = await l1.getEnsAddress({ name: n });
      if (!addr) setNameStatus(`${n}: no address record set`);
      else if (keys && addr.toLowerCase() === keys.registrant.toLowerCase()) { setNameStatus(`${n} points to your registrant. Linked.`); setLinkedName(n); }
      else setNameStatus(`${n} points to ${short(addr)}, not your registrant ${keys ? short(keys.registrant) : ''}.`);
    } catch (e) { setErr((e as Error).message.split('\n')[0]); }
  }

  function finish() {
    if (!keys) return;
    store.set({
      registrant: keys.registrant, stealthMetaAddress: keys.stealthMetaAddress, chainId: cfg.chainId,
      registrationBlock: regBlock ? String(regBlock) : undefined, ledger: [], ensName: linkedName,
    });
    onDone();
  }

  return (
    <div>
      <p className="muted">Step {step} of 4</p>
      <ErrorLine error={err ?? keyError} />

      {step === 1 && (
        <section>
          <h2>1. Derive keys</h2>
          {!isConnected ? (
            <button onClick={() => connect({ connector: connectors[0] })}>Connect wallet</button>
          ) : (
            <p>Connected {address && short(address)}. This wallet only signs one message; it never sends a transaction here.</p>
          )}
          {isConnected && !keys && <button disabled={busy} onClick={() => unlock().catch(() => {})}>{busy ? 'Waiting for signature…' : 'Sign to derive keys'}</button>}
          {keys && (
            <table><tbody>
              <tr><th>Meta-address</th><td><code>{keys.stealthMetaAddressURI}</code> <Copy value={keys.stealthMetaAddressURI} /></td></tr>
              <tr><th>Spending pub</th><td><code>{keys.spendingPublicKey}</code></td></tr>
              <tr><th>Viewing pub</th><td><code>{keys.viewingPublicKey}</code></td></tr>
              <tr><th>Registrant</th><td><code>{keys.registrant}</code> <Copy value={keys.registrant} /><br /><span className="muted">Throwaway. Never send funds to it from your wallet.</span></td></tr>
            </tbody></table>
          )}
          {keys && (
            <p>
              <button onClick={exportBackup}>Export backup JSON</button>
              <span className="warn">Losing this wallet and the backup means losing every payment.</span>
            </p>
          )}
          <button disabled={!keys} onClick={() => setStep(2)}>Next</button>
        </section>
      )}

      {step === 2 && keys && (
        <section>
          <h2>2. Register on-chain (gasless)</h2>
          <p>Registry <code>{cfg.registry}</code> on {cfg.chain.name}.</p>
          <p>Status: {registered ? <span className="ok">registered{regBlock ? ` at block ${regBlock}` : ''}</span> : 'not registered'}
            {regTx && <> · tx <a href={explorerTx(cfg, regTx)} target="_blank" rel="noreferrer">{short(regTx)}</a></>}</p>
          {!registered && <button onClick={register}>Register</button>}
          <button onClick={checkRegistered}>Check</button>
          <button disabled={!registered} onClick={() => setStep(3)}>Next</button>
        </section>
      )}

      {step === 3 && keys && (
        <section>
          <h2>3. Link a name (optional)</h2>
          <p>Set the name's address record to <code>{keys.registrant}</code> from the wallet that owns the name. Then check.</p>
          <input placeholder="alice.eth or alice.base.eth" value={name} onChange={(e) => setName(e.target.value)} />
          <button onClick={checkName} disabled={!name.trim()}>Check</button>
          {nameStatus && <p>{nameStatus}</p>}
          <p>
            <a href="https://app.ens.domains" target="_blank" rel="noreferrer">Open ENS manager</a> ·{' '}
            <a href="https://www.base.org/names" target="_blank" rel="noreferrer">Open Basenames</a>
          </p>
          <button onClick={() => setStep(4)}>{linkedName ? 'Next' : 'Skip, share address instead'}</button>
        </section>
      )}

      {step === 4 && keys && (
        <section>
          <h2>4. Share</h2>
          <p>Give the sender any one of these.</p>
          <table><tbody>
            {linkedName && <tr><th>Name</th><td>{linkedName} <Copy value={linkedName} /></td></tr>}
            <tr><th>Registrant address</th><td><code>{keys.registrant}</code> <Copy value={keys.registrant} /></td></tr>
            <tr><th>Meta-address</th><td><code>{keys.stealthMetaAddressURI}</code> <Copy value={keys.stealthMetaAddressURI} /></td></tr>
          </tbody></table>
          <button onClick={finish}>Go to dashboard</button>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Temporary Dashboard stub so the page compiles**

`web/src/app/receive/Dashboard.tsx` (replaced in Task 11):
```tsx
'use client';
export function Dashboard({ onReset }: { onReset: () => void }) {
  return <p>Dashboard placeholder. <button onClick={onReset}>reset</button></p>;
}
```

- [ ] **Step 4: Manual check on Base Sepolia**

Prereqs: MetaMask (or any injected wallet) on Base Sepolia; a dev relayer key with ~0.01 Base Sepolia ETH in `web/.env.local` as `RELAYER_PRIVATE_KEY`.

Run `cd web && pnpm dev`, open `/receive`:
1. Connect, sign. Meta-address and registrant appear. Export downloads a JSON.
2. Register. Relay returns a tx; status flips to registered with a block number. Open the explorer link, confirm `registerKeysOnBehalf` succeeded and the emitting registrant matches.
3. Skip name. Share card shows. Go to dashboard shows the placeholder.
4. Reload: placeholder appears again (state persisted). `localStorage` key `soapay:recipient:84532` contains no `PrivateKey` fields.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/receive
git commit -m "web: receive onboarding wizard with gasless registration"
```

---

### Task 11: Receive dashboard and row detail

**Files:**
- Modify: `web/src/app/receive/Dashboard.tsx` (replace stub)

**Interfaces:**
- Consumes: `scanRange`, `makeGetLogs`, `mergeLedger` (Task 5), `computeStealthKey` from the SDK, store (Task 8), `useKeys` (Task 9), `fmtUnits`, `explorerTx` (Task 9).

- [ ] **Step 1: Implement Dashboard**

`web/src/app/receive/Dashboard.tsx`:
```tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { erc20Abi, type Hex } from 'viem';
import { computeStealthKey, VALID_SCHEME_ID } from '@scopelift/stealth-address-sdk';
import { chainConfig } from '@/config/chains';
import { useKeys } from '@/hooks/KeysProvider';
import { scanRange, makeGetLogs, mergeLedger, type LedgerEntry } from '@/lib/stealth/scan';
import { createRecipientStore, browserStorage, type RecipientState } from '@/lib/store/recipientStore';
import { Copy } from '@/components/Copy';
import { ErrorLine } from '@/components/ErrorLine';
import { explorerTx, fmtUnits, short } from '@/lib/format';

export function Dashboard({ onReset }: { onReset: () => void }) {
  const cfg = chainConfig;
  const publicClient = usePublicClient()!;
  const { keys, unlock, busy, error: keyError } = useKeys();
  const store = useMemo(() => createRecipientStore(browserStorage(), cfg.chainId), [cfg.chainId]);
  const [state, setState] = useState<RecipientState | null>(() => store.get());
  const [scanning, setScanning] = useState<string>();
  const [err, setErr] = useState<string>();
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string>();
  const [revealed, setRevealed] = useState<Record<string, Hex>>({});

  const keyMismatch = keys && state && keys.registrant.toLowerCase() !== state.registrant.toLowerCase();

  async function rescan(full = false) {
    if (!keys || !state) return;
    setErr(undefined);
    try {
      const start = full
        ? BigInt(state.scanFromBlock ?? state.registrationBlock ?? String(cfg.scanStartBlock))
        : BigInt(state.lastScannedBlock ?? state.scanFromBlock ?? state.registrationBlock ?? String(cfg.scanStartBlock));
      const { entries, scannedTo } = await scanRange({
        keys, fromBlock: start, chunkSize: cfg.scanChunkSize,
        deps: { getLogs: makeGetLogs(publicClient, cfg.announcer), latestBlock: () => publicClient.getBlockNumber() },
        onProgress: (to, total) => setScanning(`Scanning block ${to} of ${total}`),
      });
      const ledger = mergeLedger(full ? [] : state.ledger, entries);
      store.update({ ledger, lastScannedBlock: String(scannedTo) });
      setState(store.get());
    } catch (e) { setErr((e as Error).message.split('\n')[0]); }
    finally { setScanning(undefined); }
  }

  async function refreshBalances(ledger: LedgerEntry[]) {
    const out: Record<string, string> = {};
    await Promise.all(ledger.map(async (e) => {
      try {
        const b = await publicClient.readContract({ address: cfg.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [e.stealthAddress] });
        out[e.stealthAddress] = String(b);
      } catch { out[e.stealthAddress] = 'error'; }
    }));
    setBalances(out);
  }

  useEffect(() => { if (state?.ledger.length) refreshBalances(state.ledger); }, [state?.ledger.length]);

  function reveal(e: LedgerEntry) {
    if (!keys) return;
    const k = computeStealthKey({
      ephemeralPublicKey: e.ephemeralPublicKey, schemeId: VALID_SCHEME_ID.SCHEME_ID_1,
      spendingPrivateKey: keys.spendingPrivateKey, viewingPrivateKey: keys.viewingPrivateKey,
    });
    setRevealed((r) => ({ ...r, [e.stealthAddress]: k }));
  }

  if (!state) return null;
  const total = state.ledger.reduce((acc, e) => acc + (e.amount && e.token === cfg.usdc.toLowerCase() ? BigInt(e.amount) : 0n), 0n);

  return (
    <div>
      <p>
        {state.ensName ? <strong>{state.ensName}</strong> : null} <code>{short(state.registrant)}</code>
        {' · '}<span className="muted">last scan: {state.lastScannedBlock ? `block ${state.lastScannedBlock}` : 'never'}</span>
      </p>
      <ErrorLine error={err ?? keyError} />
      {keyMismatch && <ErrorLine error={`Connected wallet derives registrant ${short(keys!.registrant)} but this browser is set up for ${short(state.registrant)}. Switch wallet or reset in Settings.`} />}
      {!keys ? (
        <button disabled={busy} onClick={() => unlock().catch(() => {})}>{busy ? 'Waiting for signature…' : 'Sign to unlock'}</button>
      ) : (
        <>
          <button disabled={!!scanning || !!keyMismatch} onClick={() => rescan(false)}>Rescan</button>
          <button disabled={!!scanning || !!keyMismatch} onClick={() => rescan(true)}>Full rescan</button>
          {scanning && <span className="muted">{scanning}</span>}
        </>
      )}
      <p>Total received: <strong>{fmtUnits(total, cfg.usdcDecimals)} USDC</strong>, {state.ledger.length} payments</p>

      {state.ledger.length === 0 ? (
        <p className="muted">No payments yet. Share your meta-address: <code>st:eth:{state.stealthMetaAddress}</code> <Copy value={`st:eth:${state.stealthMetaAddress}`} /></p>
      ) : (
        <table>
          <thead><tr><th>Block</th><th>From</th><th>Token</th><th>Amount</th><th>Balance</th><th>Stealth address</th><th>Tx</th><th></th></tr></thead>
          <tbody>
            {state.ledger.map((e) => (
              <FragmentRow key={`${e.txHash}:${e.stealthAddress}`} e={e} isOpen={open === e.stealthAddress}
                onToggle={() => setOpen(open === e.stealthAddress ? undefined : e.stealthAddress)}
                balance={balances[e.stealthAddress]} revealed={revealed[e.stealthAddress]} onReveal={() => reveal(e)} />
            ))}
          </tbody>
        </table>
      )}
      <p className="muted"><button onClick={() => { store.clear(); onReset(); }}>Reset local data</button> Keys are recoverable by signing again.</p>
    </div>
  );
}

function FragmentRow({ e, isOpen, onToggle, balance, revealed, onReveal }: {
  e: LedgerEntry; isOpen: boolean; onToggle: () => void; balance?: string; revealed?: Hex; onReveal: () => void;
}) {
  const cfg = chainConfig;
  const isUsdc = e.token === cfg.usdc.toLowerCase();
  return (
    <>
      <tr>
        <td>{e.blockNumber}</td>
        <td><code>{short(e.caller)}</code></td>
        <td>{e.token ? (isUsdc ? 'USDC' : short(e.token)) : <span className="muted">unknown</span>}</td>
        <td>{e.amount && isUsdc ? fmtUnits(e.amount, cfg.usdcDecimals) : <span className="muted">unknown</span>}</td>
        <td>{balance === undefined ? '…' : balance === 'error' ? 'error' : fmtUnits(balance, cfg.usdcDecimals)}</td>
        <td><code>{short(e.stealthAddress)}</code> <Copy value={e.stealthAddress} /></td>
        <td><a href={explorerTx(cfg, e.txHash)} target="_blank" rel="noreferrer">{short(e.txHash, 4)}</a></td>
        <td><button onClick={onToggle}>{isOpen ? 'close' : 'detail'}</button></td>
      </tr>
      {isOpen && (
        <tr><td colSpan={8}>
          <div>Stealth address <code>{e.stealthAddress}</code></div>
          <div>Ephemeral pubkey <code>{e.ephemeralPublicKey}</code></div>
          <div>View tag <code>{e.viewTag}</code> · metadata <code>{e.metadata}</code></div>
          <div>
            Spending private key:{' '}
            {revealed ? <><code>{revealed}</code> <Copy value={revealed} /></> : <button onClick={onReveal}>reveal</button>}
            <span className="muted"> Import into a wallet to spend. In-app spend arrives in M2.</span>
          </div>
        </td></tr>
      )}
    </>
  );
}
```

- [ ] **Step 2: Manual check**

Continue from Task 10's registered browser. Rescan: expect "Scanning block …" then "No payments yet". Comes back fast because the range starts at the registration block. This is the pre-payment state; payments are verified in Task 14.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/receive/Dashboard.tsx
git commit -m "web: receive dashboard with bounded rescan, balances and key reveal"
```

---

### Task 12: Pay editor, review, result

**Files:**
- Create: `web/src/app/pay/page.tsx`, `web/src/app/pay/Editor.tsx`, `web/src/app/pay/Review.tsx`, `web/src/app/pay/Result.tsx`

**Interfaces:**
- Consumes: `parseBatchText`, `resolveRecipient`, `Resolved` (Task 3), `deriveRows`, `PlannedRow` (Task 4), `buildBatchCalls`, `createWalletBatchSender`, `BatchResult` (Task 7), `createSenderStore` (Task 8), `readRegisteredMeta` (Task 6).
- Produces: page state machine `editor -> review -> result`.

- [ ] **Step 1: Page state machine**

`web/src/app/pay/page.tsx`:
```tsx
'use client';
import { useState } from 'react';
import type { PlannedRow } from '@/lib/stealth/derive';
import type { BatchResult } from '@/lib/batch/types';
import { Editor } from './Editor';
import { Review } from './Review';
import { Result } from './Result';

type Stage =
  | { name: 'editor' }
  | { name: 'review'; rows: PlannedRow[] }
  | { name: 'result'; rows: PlannedRow[]; result: BatchResult };

export default function PayPage() {
  const [stage, setStage] = useState<Stage>({ name: 'editor' });
  if (stage.name === 'editor') return <Editor onContinue={(rows) => setStage({ name: 'review', rows })} />;
  if (stage.name === 'review') return (
    <Review rows={stage.rows} onBack={() => setStage({ name: 'editor' })}
      onSent={(result) => setStage({ name: 'result', rows: stage.rows, result })} />
  );
  return <Result rows={stage.rows} result={stage.result} onNew={() => setStage({ name: 'editor' })} />;
}
```

- [ ] **Step 2: Editor**

`web/src/app/pay/Editor.tsx`:
```tsx
'use client';
import { useMemo, useState } from 'react';
import { useAccount, useConnect, usePublicClient, useReadContract } from 'wagmi';
import { createPublicClient, erc20Abi, http } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';
import { chainConfig } from '@/config/chains';
import { parseBatchText, resolveRecipient, type Resolved, type BatchLine } from '@/lib/stealth/recipient';
import { deriveRows, type PlannedRow } from '@/lib/stealth/derive';
import { readRegisteredMeta } from '@/lib/stealth/register';
import { createSenderStore } from '@/lib/store/senderStore';
import { browserStorage } from '@/lib/store/recipientStore';
import { ErrorLine } from '@/components/ErrorLine';
import { fmtUnits, short } from '@/lib/format';

const MAX_ROWS = 400;

export function Editor({ onContinue }: { onContinue: (rows: PlannedRow[]) => void }) {
  const cfg = chainConfig;
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const publicClient = usePublicClient()!;
  const store = useMemo(() => createSenderStore(browserStorage()), []);
  const [text, setText] = useState(() => store.get().draft);
  const [resolved, setResolved] = useState<Resolved[]>([]);
  const [resolving, setResolving] = useState(false);
  const [err, setErr] = useState<string>();

  const { lines, errors } = useMemo(() => parseBatchText(text, cfg.usdcDecimals, MAX_ROWS), [text]);
  const total = lines.reduce((a, l) => a + l.amount, 0n);
  const { data: balance } = useReadContract({ address: cfg.usdc, abi: erc20Abi, functionName: 'balanceOf', args: address ? [address] : undefined, query: { enabled: !!address } });

  function onText(v: string) { setText(v); setResolved([]); store.setDraft(v); }

  async function resolveAll() {
    setResolving(true); setErr(undefined);
    try {
      const l1 = createPublicClient({ chain: mainnet, transport: http(cfg.mainnetRpcUrl) });
      const pins = store.get().pins;
      const out = await Promise.all(lines.map((l) => resolveRecipient(l.input, {
        getEnsAddress: (n) => l1.getEnsAddress({ name: normalize(n) }),
        getRegistryMeta: (r) => readRegisteredMeta(publicClient, cfg.registry, r),
        pin: pins[l.input.trim().toLowerCase()],
      })));
      out.forEach((r) => { if (r.status === 'ok' && !pins[r.input.toLowerCase()]) store.setPin(r.input, { registrant: r.registrant, metaAddress: r.metaAddress, pinnedAt: Date.now() }); });
      setResolved(out);
    } catch (e) { setErr((e as Error).message.split('\n')[0]); }
    finally { setResolving(false); }
  }

  function acceptChange(r: Extract<Resolved, { status: 'changed' }>) {
    store.setPin(r.input, { registrant: r.registrant, metaAddress: r.metaAddress, pinnedAt: Date.now() });
    setResolved((rs) => rs.map((x) => (x.input === r.input ? { status: 'ok', input: r.input, registrant: r.registrant, metaAddress: r.metaAddress } : x)));
  }

  function proceed() {
    setErr(undefined);
    try {
      const rows = deriveRows(lines.map((l, i) => {
        const r = resolved[i];
        if (!r || r.status !== 'ok') throw new Error('Resolve every row first');
        return { input: l.input, metaAddress: r.metaAddress, amount: l.amount };
      }), cfg.usdc);
      onContinue(rows);
    } catch (e) { setErr((e as Error).message); }
  }

  const allOk = lines.length > 0 && errors.length === 0 && resolved.length === lines.length && resolved.every((r) => r.status === 'ok');
  const enough = balance === undefined || balance >= total;

  return (
    <div>
      <h2>Pay a batch</h2>
      {!isConnected ? <button onClick={() => connect({ connector: connectors[0] })}>Connect wallet</button>
        : <p>Sender {address && short(address)} · USDC balance {balance === undefined ? '…' : fmtUnits(balance, cfg.usdcDecimals)}</p>}
      <p className="muted">One per line: <code>recipient, amount</code>. Recipient = ENS name, registrant address, or <code>st:eth:0x…</code> meta-address.</p>
      <textarea value={text} onChange={(e) => onText(e.target.value)} placeholder={'alice.eth, 500\n0x9f3…, 500\nst:eth:0x02ab…, 250'} />
      <ErrorLine error={err} />
      {errors.map((e) => <ErrorLine key={`${e.line}-${e.message}`} error={e.line ? `Line ${e.line}: ${e.message}` : e.message} />)}
      <p>
        <button onClick={resolveAll} disabled={resolving || lines.length === 0 || errors.length > 0}>{resolving ? 'Resolving…' : 'Resolve'}</button>
        {lines.length} rows · total {fmtUnits(total, cfg.usdcDecimals)} USDC {!enough && <span className="warn">· exceeds balance</span>}
      </p>
      {resolved.length > 0 && (
        <table>
          <thead><tr><th>#</th><th>Recipient</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            {lines.map((l: BatchLine, i) => {
              const r = resolved[i];
              return (
                <tr key={i}>
                  <td>{i + 1}</td><td><code>{l.input}</code></td><td>{l.amountText}</td>
                  <td>
                    {r.status === 'ok' && <span className="ok">ok · {r.registrant ? `${short(r.registrant)} → ` : ''}{short(r.metaAddress, 8)}</span>}
                    {r.status === 'error' && <span style={{ color: '#b00020' }}>{r.message}</span>}
                    {r.status === 'changed' && (
                      <span className="warn">meta-address changed since pinned ({short(r.pinned, 8)} → {short(r.metaAddress, 8)}).{' '}
                        <button onClick={() => acceptChange(r)}>Accept new</button></span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p><button disabled={!allOk || !isConnected || !enough} onClick={proceed}>Continue</button>
        <span className="muted">Nothing is cached between runs; Resolve always reads the chain.</span></p>
    </div>
  );
}
```

- [ ] **Step 3: Review**

`web/src/app/pay/Review.tsx`:
```tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { usePublicClient, useWalletClient } from 'wagmi';
import { chainConfig } from '@/config/chains';
import type { PlannedRow } from '@/lib/stealth/derive';
import { buildBatchCalls } from '@/lib/batch/buildCalls';
import { createWalletBatchSender } from '@/lib/batch/sendCalls';
import type { BatchMode, BatchProgress, BatchResult } from '@/lib/batch/types';
import { ErrorLine } from '@/components/ErrorLine';
import { fmtUnits, short } from '@/lib/format';

export function Review({ rows, onBack, onSent }: { rows: PlannedRow[]; onBack: () => void; onSent: (r: BatchResult) => void }) {
  const cfg = chainConfig;
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient()!;
  const [mode, setMode] = useState<BatchMode>();
  const [progress, setProgress] = useState<BatchProgress>();
  const [err, setErr] = useState<string>();
  const [sending, setSending] = useState(false);
  const sender = useMemo(() => (walletClient ? createWalletBatchSender(walletClient, publicClient, cfg.chainId) : null), [walletClient, publicClient, cfg.chainId]);

  useEffect(() => { sender?.detect().then(setMode); }, [sender]);

  async function send() {
    if (!sender) return;
    setSending(true); setErr(undefined);
    try {
      const result = await sender.send(buildBatchCalls(rows, cfg), setProgress);
      onSent(result);
    } catch (e) { setErr((e as Error).message.split('\n')[0]); }
    finally { setSending(false); }
  }

  const total = rows.reduce((a, r) => a + r.amount, 0n);
  return (
    <div>
      <h2>Review</h2>
      <p className="warn">Fresh stealth addresses generated for this run only. Do not reuse this list.</p>
      <table>
        <thead><tr><th>#</th><th>Recipient</th><th>Stealth address (new)</th><th>Amount</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.stealthAddress}><td>{i + 1}</td><td><code>{r.input}</code></td><td><code>{r.stealthAddress}</code></td><td>{fmtUnits(r.amount, cfg.usdcDecimals)}</td></tr>
          ))}
        </tbody>
      </table>
      <p>{rows.length} transfers + {rows.length} announces · total {fmtUnits(total, cfg.usdcDecimals)} USDC · rows sorted ascending by address.</p>
      <p>
        {mode === undefined && <span className="muted">Checking wallet capabilities…</span>}
        {mode === 'atomic' && <span className="ok">Wallet supports atomic batches: one transaction, one signature.</span>}
        {mode === 'sequential' && <span className="warn">Wallet has no atomic batching. {rows.length * 2} transactions: announce first, then pay. Not atomic.</span>}
      </p>
      <ErrorLine error={err} />
      {progress && <p className="muted">{progress.step} ({progress.done}/{progress.total})</p>}
      <button onClick={onBack} disabled={sending}>Back</button>
      <button onClick={send} disabled={sending || !sender || mode === undefined}>{sending ? 'Sending…' : mode === 'sequential' ? 'Send anyway' : 'Send batch'}</button>
    </div>
  );
}
```

- [ ] **Step 4: Result**

`web/src/app/pay/Result.tsx`:
```tsx
'use client';
import { chainConfig } from '@/config/chains';
import type { PlannedRow } from '@/lib/stealth/derive';
import type { BatchResult } from '@/lib/batch/types';
import { explorerTx, fmtUnits, short } from '@/lib/format';

export function Result({ rows, result, onNew }: { rows: PlannedRow[]; result: BatchResult; onNew: () => void }) {
  const cfg = chainConfig;
  function exportCsv() {
    const head = 'recipient,stealth_address,amount_usdc,tx_hashes';
    const body = rows.map((r) => `${r.input},${r.stealthAddress},${fmtUnits(r.amount, cfg.usdcDecimals)},"${result.txHashes.join(' ')}"`).join('\n');
    const blob = new Blob([`${head}\n${body}\n`], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `soapay-run-${Date.now()}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }
  return (
    <div>
      <h2>Sent ({result.mode})</h2>
      <ul>{result.txHashes.map((h) => <li key={h}><a href={explorerTx(cfg, h)} target="_blank" rel="noreferrer">{short(h, 8)}</a></li>)}</ul>
      <table>
        <thead><tr><th>Recipient</th><th>Stealth address</th><th>Amount</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.stealthAddress}><td><code>{r.input}</code></td><td><code>{r.stealthAddress}</code></td><td>{fmtUnits(r.amount, cfg.usdcDecimals)}</td></tr>)}</tbody>
      </table>
      <p className="muted">Ephemeral keys discarded. This page is the only record; export it if you need one.</p>
      <button onClick={exportCsv}>Export run CSV</button>
      <button onClick={onNew}>New batch</button>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck and build**

Run: `cd web && pnpm exec tsc --noEmit && pnpm build 2>&1 | tail -5`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/pay
git commit -m "web: pay batch editor, review and result with pinned recipients"
```

---

### Task 13: Settings

**Files:**
- Create: `web/src/app/settings/page.tsx`

- [ ] **Step 1: Implement**

`web/src/app/settings/page.tsx`:
```tsx
'use client';
import { useMemo, useState } from 'react';
import { chainConfig } from '@/config/chains';
import { createRecipientStore, browserStorage } from '@/lib/store/recipientStore';
import { createSenderStore } from '@/lib/store/senderStore';
import { useKeys } from '@/hooks/KeysProvider';

export default function SettingsPage() {
  const cfg = chainConfig;
  const rstore = useMemo(() => createRecipientStore(browserStorage(), cfg.chainId), [cfg.chainId]);
  const sstore = useMemo(() => createSenderStore(browserStorage()), []);
  const { lock, keys } = useKeys();
  const [state, setState] = useState(() => rstore.get());
  const [from, setFrom] = useState(state?.scanFromBlock ?? '');

  return (
    <div>
      <h2>Settings</h2>
      <table><tbody>
        <tr><th>Chain</th><td>{cfg.chain.name} ({cfg.chainId})</td></tr>
        <tr><th>Payroll RPC</th><td><code>{cfg.rpcUrl}</code></td></tr>
        <tr><th>Mainnet RPC (ENS)</th><td><code>{cfg.mainnetRpcUrl}</code></td></tr>
        <tr><th>Announcer</th><td><code>{cfg.announcer}</code></td></tr>
        <tr><th>Registry</th><td><code>{cfg.registry}</code></td></tr>
        <tr><th>USDC</th><td><code>{cfg.usdc}</code></td></tr>
        <tr><th>Relayer</th><td><code>{cfg.relayUrl}</code></td></tr>
        <tr><th>StealthDisperse</th><td>{cfg.stealthDisperse ? <code>{cfg.stealthDisperse}</code> : <span className="muted">not configured; using wallet batch</span>}</td></tr>
        {state && <>
          <tr><th>Registrant</th><td><code>{state.registrant}</code></td></tr>
          <tr><th>Registration block</th><td>{state.registrationBlock ?? <span className="muted">unknown (registered elsewhere?)</span>}</td></tr>
          <tr><th>Scan from block</th><td>
            <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder={state.registrationBlock ?? String(cfg.scanStartBlock)} />
            <button onClick={() => { rstore.update({ scanFromBlock: from.trim() || undefined, lastScannedBlock: undefined }); setState(rstore.get()); }}>Save</button>
            <span className="muted"> Overrides the start block for the next full rescan.</span>
          </td></tr>
        </>}
      </tbody></table>
      <p>
        <button onClick={lock} disabled={!keys}>Lock keys (forget for this session)</button>
        <button onClick={() => { rstore.clear(); setState(null); }}>Reset recipient data</button>
        <button onClick={() => sstore.clear()}>Reset sender pins and draft</button>
      </p>
      <p className="muted">Keys are recoverable by signing again with the same wallet. Ledger is rebuilt by a full rescan.</p>
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `cd web && pnpm build 2>&1 | tail -5`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/settings
git commit -m "web: settings page with scan start override and resets"
```

---

### Task 14: End-to-end self-pay on Base Sepolia, README

**Files:**
- Create: `web/README.md`

- [ ] **Step 1: Fund the sender**

Sender wallet on Base Sepolia needs Base Sepolia ETH (faucet) and test USDC from Circle's faucet (`https://faucet.circle.com`, select Base Sepolia). Confirm the token address matches `cfg.usdc`; if Circle's faucet USDC differs, set `NEXT_PUBLIC_USDC_ADDRESS` in `.env.local`.

- [ ] **Step 2: Run the self-pay demo**

1. `/receive`: complete the wizard as in Task 10 if not already done. Copy the meta-address from the share card or dashboard.
2. `/pay`: connect the same wallet. Paste `st:eth:0x…, 1` and a second line `st:eth:0x…, 2` (same meta-address twice). Resolve: both `ok`. Continue.
3. Review: two distinct stealth addresses, ascending. Note the mode line. Send.
   - MetaMask with smart-account upgrade enabled: expect one prompt, mode `atomic`.
   - Otherwise: mode `sequential`, four prompts, announces first.
4. Result: tx links open on Basescan. Check the receipt logs: `Transfer` events and `Announcement` events, `caller` equals the sender address in atomic mode.
5. `/receive`: Rescan. Two rows appear with amounts 1 and 2, balances 1 and 2, `from` = sender.
6. Row detail: reveal shows a private key. Import it into a throwaway wallet and confirm the address matches the stealth address.

- [ ] **Step 3: Invariant checks**

- I1: run a second batch to the same meta-address. New addresses differ from the first run's.
- I3 (atomic): one tx receipt holds all `Transfer` and `Announcement` logs.
- I4: Settings, Reset recipient data. `/receive` shows the wizard; connect, sign, Register says already registered (Check), skip name, dashboard, Full rescan with scan-from-block set to the registration block. Same rows return.
- Bad inputs in the editor: `nobody-xyz-123.eth, 1` errors on Resolve; `0x000…001, 1` errors "No stealth meta-address registered"; `alice.eth, 1.1234567` errors at parse; amount over balance disables Continue.
- Storage: DevTools Application tab, `soapay:recipient:84532` has no `PrivateKey` fields, `soapay:sender` has only pins and draft.

- [ ] **Step 4: README**

`web/README.md`:
```md
# Soapay web (M1)

Plain Next.js app: `/receive` (employee) and `/pay` (employer). Spec: `../docs/specs/2026-09-25-frontend-m1-design.md`.

## Run

    cp .env.example .env.local   # set RELAYER_PRIVATE_KEY to a dev key with a little Base Sepolia ETH
    pnpm install
    pnpm dev                     # http://localhost:3100
    pnpm test

## What talks to what

- Wallet: signs one message (key derivation). On `/pay` it also sends the batch.
- `/api/relay`: mock relayer, submits `registerKeysOnBehalf` from `RELAYER_PRIVATE_KEY`. Backend replaces it; same request shape (`src/lib/stealth/register.ts`).
- Payroll chain RPC: registry reads, announcement scan, USDC balances.
- Mainnet RPC: ENS resolution only.

## Not persisted

Spending, viewing and registrant private keys. They are re-derived by signing again. Stealth addresses from a pay run are not stored by the sender.

## Batch sender

`src/lib/batch/sendCalls.ts` uses EIP-5792 atomic batches when the wallet supports them, else announce-then-pay sequentially. When `StealthDisperse` ships, add an adapter implementing `BatchSender` in `src/lib/batch/` and select it when `NEXT_PUBLIC_STEALTH_DISPERSE_ADDRESS` is set.

## Notes

- Record here anything Task 1 step 8 or Task 5 step 4 required (transpilePackages, deep import paths).
```

- [ ] **Step 5: Commit and push the branch**

```bash
git add web/README.md
git commit -m "web: README and end-to-end notes for the M1 demo"
git push -u origin frontend-m1
```

Do not merge. Report results of Steps 2 and 3 to the user, including anything that did not behave as expected, and wait for confirmation.

---

## Self-review notes

- Spec coverage: R1 (Task 10), R2/R3 (Task 11), R4 (Task 13), P1/P2/P3 (Task 12), relayer (Task 6), scanner (Task 5), pins + changed-meta alert (Task 3, 12), ascending order + duplicates (Task 4), ERC-20 metadata (Task 4, 5), no secrets persisted (Task 8, 9), chain config (Task 1), invariants I1/I3/I4 (Task 14).
- Deferred by spec: `StealthDisperse` adapter (contract not written), subgraph scan, gateway, spend.
- Known risk: SDK named exports at the package root for `getAnnouncements`, `getAnnouncementsForUser`, `ERC5564AnnouncerAbi`, `ERC6538RegistryAbi`, `ERC5564_StartBlocks`. The agent report lists them; Task 1 step 8 and Task 5 step 4 say what to do if a deep import is needed.
- Known risk: `getCapabilities` response shape differs between wallets (`atomic.status` in the final EIP-5792, `atomicBatch.supported` in older MetaMask). Task 7 checks both.
