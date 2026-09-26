# Privacy Pools v2: context for Soapay's shielded rail

Source: https://privacy-pools-v2-docs.vercel.app/llms-full.txt (read 2026-09-26). The PRD names **Railgun or Privacy Pools v2** for the v2 shielded rail. Railgun isn't on Base, so PP v2 is the PRD-aligned path. See `docs/drift-audit.md` and `docs/shielded-rail-research.md`.

## What it is

A note-based shielded pool (UTXO model) with association-set (ASP) screening. That's the same compliance model as the v1 pool we already use for the exit.
- **Private transfers inside the pool:** notes are encrypted to the recipient's viewing key, so **amounts and parties are hidden**.
- **Withdrawals** to public addresses, including **stealth withdrawals**.
- **Payment requests, batch withdraw, yield, swaps, and selective-disclosure receipts** (useful for payroll compliance: an employee can prove one payment to a third party).

## Why it fits Soapay well

- **Stealth withdrawals use our exact scheme.** ERC-5564 **scheme 1 (canonical, `0x0001`)**, announced on **the same canonical Announcer** `0x5564…5564`, atomically with the withdrawal via `PrivacyPoolRelay.relayAndAnnounce` (the contract enforces that the announced address is the paid one). **Our existing scanner finds these payments unchanged.**
- **"Privacy-preserving group payouts"** is a documented capability: one sender pays many recipients, each by viewing pubkey. 0xbow has also built a **Payroll PoC** (Next.js), mentioned in their debugging docs.
- **USDC is supported on Sepolia:** `0x1c7D4B19…7238`, the same Circle USDC our exit already uses.
- **Selective disclosure:** a recipient can prove a single payment to an auditor without revealing others. It answers the "compliant" half of our pitch.

## Candidate design (for when we have SDK access)

1. **Employer:** deposits the total payroll into PP v2 once (one public deposit of the total), then after ASP approval sends **one private transfer per employee** to the employee's viewing key. Per-person amounts are never public.
2. **Employee:**
   - holds notes in the pool, and sees a balance via `discoverNotes()`;
   - cashes out with a **stealth withdrawal** to their Soapay meta-address, which our scanner picks up; or does a normal withdrawal through the relayer to any destination (the same property as our exit).
3. **Keys:** PP v2 derives its three keys from one EIP-712 signature (`deriveKeysFromSignature`, revocable index). We could sign that payload **with a key derived from the Soapay recovery phrase**, which gives deterministic ECDSA and keeps "the phrase recovers everything". That needs checking against their revocable-key design.
4. **Chain:** the pool is on **Ethereum (Sepolia for testing; Ethereum mainnet deployed; also BNB and Citrea)**, not Base. The employer bridges the total once (CCTP), or the employer pays from Ethereum.

## Constraints to plan around

- **The SDK isn't public:** early-access partners get the `v2-monorepo`. Request it via X: **@0xbowio**.
- **The Sepolia V9 relay exposes only `relay()`.** `relayAndAnnounce` (stealth withdraw), `relayBatch` and `registerAndRelay` need the newer relay, which is on **mainnet** (`PrivacyPoolRelay 0x01a8Fa4d…A461`, `MAX_BATCH()` = 10) and awaits a Sepolia redeploy.
- **Keystore registration is two transactions paid in ETH**, unless `registerAndRelay` is available.
- **The circuit caps transactions at 5 inputs × 5 outputs.** Paying N employees takes about N/4 transfers (or payment requests). Proving runs client-side, so artifacts must be served.
- **ASP approval of deposits** takes "often within an hour, up to 7 days".
- **Batch withdraw** requires the same recipient and token for every item.

## Sepolia V9 addresses (from the docs)

| | Address |
| --- | --- |
| PoolVault | `0x09b94d3127019298757A6ceeB7911922085f7C01` |
| Entrypoint | `0xEB3e3961008952348445513e418ad6F43C23ca9a` |
| Keystore | `0x6d264aCb9C3A7A3105c29470AfE2F5F1EC203C73` |
| ASPRegistry | `0x35D29EFDCf067599ab4A53cf40229477f0b1cA9c` |
| Relay (processor, V9) | `0x762665Dc7aAeeA25DC1759AEBef1F61730497f6e` |
| ASP | `https://api-dev.0xbow.io` |
| Relayer | `https://relayer-v2-staging-149184580131.us-east1.run.app` |

## Next step

Request SDK access from 0xbow, mentioning that our payroll use case needs group payouts plus stealth withdrawals to ERC-5564 scheme 1, and ask when `relayAndAnnounce` reaches Sepolia.
