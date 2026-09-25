# PRD analysis

Review of `PRD.md` (Sep 25, 2026) before M1. Decisions taken are recorded in `.claude/memory/`.

> [!IMPORTANT]
> The team later agreed a narrower threat model, with a coworker as the only adversary and the employer trusted. It is in `CLAUDE.md` and wins over this document where they differ. Under it, gateway mode, chain-analyst threats and the Privacy Pools exit are proposed cuts, so items 3–5 and 10 below are dormant.

## Decided (2026-09-25)

| Topic | Decision | Reason |
| --- | --- | --- |
| Apps | Vite + React static SPAs | Key-holding apps shouldn't depend on a server we run |
| Names | Offchain subnames `*.soapay.eth` via CCIP-Read | Avoids the `addr` footgun and L1 gas |
| Atomic pay run | `StealthDisperse` for plain EOAs; EIP-5792 `wallet_sendCalls` batch for smart accounts, 7702 and Safe (pending team confirmation) | Disperse behind a multicall can't pull from an EOA; the contract fixes that, but it is a blacklist chokepoint and permits fail for 7702 accounts |
| Assets | USDC on Base only | Matches the USDC paymaster and the wedge |
| Gateway announcements | Announce at resolve, as in the PRD; dormant, since gateway mode is a proposed cut | Keeps invariant 3; risks listed below |
| Seed | BIP-39 mnemonic (default, **unconfirmed**) | PRD only says "a single seed the employee backs up" |

## Issues that break the design as written

1. **`addr = registrant` becomes a static receiving address.** Any plain wallet resolving the name pays the registrant. That breaks privacy and links payments to each other. A name owned by the employee's main wallet also means that wallet signs record updates publicly. *Resolved by the naming decision.*
2. **Disperse plus announce via Multicall3 fails from an EOA.** *Resolved by `StealthDisperse` (EOAs) and EIP-5792 (smart accounts).*
3. **Gateway announcements share a caller.** `Announcement.caller` is indexed. A per-recipient self-hosted gateway announces every address from one account, which links them all. In the hosted gateway, the anonymity set is its tenants. *Kept per PRD; M3 must mitigate, for example with a shared announcing relayer.*
4. **Counter burn and gas griefing.** Wallets resolve names repeatedly. Each resolve uses a counter value and, when the gateway announces, gas. Rate limits help. The recipient-side audit must tolerate large gaps in the counter.
5. **Fingerprints outside the chain graph.** One shared 7702 delegate marks every Soapay stealth account, the bundler and paymaster see IPs, and the guard ignores timing correlation between spends.

## Gaps and inconsistencies

6. **ENS lives on L1 while everything else is on Base.** Resolving for Base needs the ENSIP-11 coinType. `registerKeysOnBehalf` is a plain call that needs a sponsoring relayer; a 4337 paymaster can't pay for it.
7. **Denominated payouts.**
   - Carrying the remainder over under- or over-pays wages each month.
   - Consolidating chunks reveals the chunk count, and so the salary.
   - 100 recipients × ~10 chunks is about 1,000 transfers. That may exceed the Fusaka per-transaction gas cap (~16.7M) if Base enforces it.
8. **Scanner target.** Scanning a year of Base logs in under 10 s over plain RPC isn't realistic. It needs an indexer or snapshot that serves all announcements, with filtering done on the client.
9. **Telemetry.** The "client-side vs gateway" and "guard warnings acted on" metrics need collection that must be opt-in or computed on the device.
10. **Privacy Pools exit (P2).** The fresh mainnet address needs ETH for gas to deposit, which is another funding-link risk.
11. **Custom contracts.** `StealthDisperse` and, for subnames, a CCIP-Read OffchainResolver are custom contracts. Neither holds funds, but the PRD's "nothing custom deployed" wording needs updating.
12. **Announcement metadata.** Metadata carries selector, token and amount after the view tag (`StealthDisperse` also appends the payer). Anyone can announce with a fake token, so scanners use these fields only as hints: they recompute the stealth address and read the real balance.

## Verified

- Canonical Announcer `0x55649E01B5Df198D18D95b5cc5051630cfD45564` and Registry `0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538` have code on Base mainnet. The Announcer's Base start block is 15502414.
- ScopeLift SDK scheme-1 round trip (derive, detect by view tag, recover the spending key) passes in `packages/sdk/test`.

## Still to verify (from the PRD checklist)

- EntryPoint v0.8 7702 support and a USDC paymaster on Base (e.g. Circle Paymaster).
- Which widely used 4337 account to use as the 7702 delegate.
- Target employer wallets support atomic `wallet_sendCalls` on Base.
- Privacy Pools chain and asset list from 0xbow docs; Umbra v2 batch-send status.
