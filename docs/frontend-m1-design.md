# Soapay frontend, M1 P0: must-have features, flows, screens

## Context

Repo `~/Documents/GitHub/soapay` holds one file, `PRD.md`. No code. User owns the frontend.
Backend/chain owner is someone else; chain not yet chosen. Before building UI, we confirm
the minimum feature set, the flows, and the screens for the first cut.

Decisions so far (user):
- Both apps in one dashboard: `/receive` (employee) and `/pay` (employer).
- Milestone M1, P0 rows only. Spend (M2), gateway (M3), exits (M4) out.
- Chain: configurable. One `CHAIN_ID` env; nothing hardcoded to Base.
- Ugly is fine. Function first.
- Relayer: mock `/api/relay` route in Next.js with a dev-only funded key, same request shape
  the backend will implement, swapped by env var.
- ENS: nobody owns a name yet. ENS step is optional "link a name you own"; demo pays by raw
  meta-address or registrant address.
- Scanner: bounded `eth_getLogs` from the block recorded at registration, chunked.

## What M1 P0 is, from the PRD (source of truth)

Recipient app P0:
1. Create spending + viewing keys from one seed; show backup once.
2. Register meta-address on ERC-6538 via throwaway registrant, gasless.
3. Issue or link an ENS name; write `addr` and `stealth` text record.
4. Scan Announcer events by view tag; ledger with token, amount, tx.

Sender app P0:
5. Paste names + amounts; resolve every name on every run, never cached.
6. Client-side derivation per recipient; ephemeral keys discarded after announce.
7. One tx: multisend transfers + announce for every recipient, atomic.

SDK P0:
8. TS package wrapping derivation, registry, announce, scan. Apps consume only SDK.

CI invariants that touch the frontend (PRD non-functional):
- I1 no stealth address returned twice.
- I3 every payment's announcement in the same tx.
- I4 ledger rebuilds from seed + chain alone.

## Verified external facts (2026-09-25, sources in agent report)

SDK `@scopelift/stealth-address-sdk` 1.0.0-beta.5, ESM, bundles viem ^2.9.16.
Exports cover every M1 need: `generateStealthMetaAddressFromSignature`,
`generateKeysFromSignature`, `generateStealthAddress`, `checkStealthAddress`,
`computeStealthKey`, `getViewTag`, `prepareRegisterKeysOnBehalf`,
`generateSignatureForRegisterKeysOnBehalf`, `prepareAnnounce`, `getAnnouncementsForUser`,
`watchAnnouncementsForUser`, `getAnnouncementsUsingSubgraph`, `buildMetadataForERC20`,
`parseMetadata`, `createStealthClient`. Chains: mainnet, Sepolia, Base, Base Sepolia,
Arbitrum(+Sepolia), OP(+Sepolia), Polygon, Gnosis, Scroll, Holesky. Browser use not
stated by the package; deps are browser-safe.

Contracts: Announcer `0x55649E01B5Df198D18D95b5cc5051630cfD45564`, Registry
`0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538`, verified on Base + Base Sepolia.

Registry ABI: `registerKeysOnBehalf(address registrant, uint256 schemeId, bytes signature,
bytes stealthMetaAddress)`; EIP-712 domain name `ERC6538Registry` version `1.0`, typehash
`Erc6538RegistryEntry(uint256 schemeId,bytes stealthMetaAddress,uint256 nonce)`;
`stealthMetaAddressOf(address,uint256) -> bytes`; `nonceOf(address)`.
Announcer: `announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey,
bytes metadata)`; event `Announcement(schemeId, stealthAddress, caller indexed;
ephemeralPubKey, metadata)`. **Event carries no amount or token.** `metadata[0]` = view
tag; SDK `buildMetadataForERC20` packs selector + token + amount after it.

ENS meta-address record: **no finalized standard.** Draft ENSIP-30 (PR ensdomains/ensips#88,
open, number assigned 2026-09-17) uses `data()` records keyed
`stealth-meta-address[<schemeId>][<coinType>]`, not `text()`. PRD's `stealth` text record
is not a convention. Umbra uses its own resolver; Fluidkey uses CCIP-Read.
=> M1 truth path: ENS `addr` -> registrant -> `stealthMetaAddressOf(registrant, 1)`.

ENS resolution always starts on Ethereum L1 (docs.ens.domains/web/resolution). viem `base`
chain has no ENS contracts. => frontend needs a **mainnet RPC** for names plus the payroll
chain RPC. Basenames `*.base.eth` resolve via CCIP-Read from L1; records are set on the
Base L2Resolver (`0xC6d5...3BCD` mainnet Base, `0x6533...7eBA` Base Sepolia).

Implications for the frontend feature list:
- Sender input must accept a name (`.eth`, `.base.eth`) **or** a raw registrant `0x`
  **or** a raw `st:eth:0x` meta-address. Demo must not depend on owning an ENS name.
- Sender must write ERC-20 metadata (token, amount) into every announce.
- Recipient ledger shows amount from metadata, then confirms with a live balance read.
- "Gasless register" means someone else submits `registerKeysOnBehalf`. That is a relayer.
  Backend dependency. Frontend must not fall back to the main wallet submitting it, since
  that links main wallet -> registrant on-chain.
- Scanning: bound `eth_getLogs` by the block recorded at registration. Full-history scan
  needs the subgraph path or an indexer. Backend dependency for anything past a demo.

Atomic transfer + announce from an EOA sender (agent 2, sources in report):
- Multicall3 (`0xcA11...CA11`) cannot move the sender's ERC-20 and would record itself as
  Announcement `caller`. Disperse (`0xD152...2150` on Base) needs a prior approve, so not
  atomic with announce either.
- Working pattern: the sender EOA batches via EIP-7702. Browser wallet => EIP-5792
  `wallet_sendCalls` (viem `sendCalls` + `getCapabilities` atomic check). One prompt,
  calls `[USDC.transfer x N, Announcer.announce x N]`, `msg.sender` = sender EOA, no
  approve. Local key => viem `toSimple7702SmartAccount` + bundler.
- Fallback when the wallet lacks atomic batching: two transactions, **announce first**
  (Multicall3 aggregate, caller = Multicall3), then transfers. Unpaid announcement is
  harmless (PRD's own gateway reasoning). Shown as "not atomic" in the UI.

M2 spend gate, verified but out of this cut: EntryPoint v0.8
`0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` on Base + Base Sepolia, native 7702 path;
Simple7702Account `0xe6Cae83BdE06E4c305530e199D7217f42808555B` verified on Base; Circle
USDC paymaster v0.8 (Base `0x0578...00Ec`, Base Sepolia `0x3BA9...8966`) takes gas via
USDC permit, zero ETH; viem >= 2.28 supports `authorization` on userOps. CCTP v2 on Base
(domain 6) -> Ethereum works; M4 only.

## Delta from teammate's `origin/soapay-contracts` CLAUDE.md (read 2026-09-25, not on main)

Teammate's agreed design overrides the PRD where they differ. Frontend consequences:
- Chain is Base. Still read from config; default Base Sepolia for dev, Base for prod.
- **Batch sender = `StealthDisperse.payWithPermit`** (custom contract, not yet written):
  EOA signs an EIP-2612 USDC permit, one tx pulls tokens, transfers, announces via the
  canonical Announcer. Announcement `caller` = the contract. No EIP-5792 needed.
  Until the contract ships, keep the EIP-5792 `sendCalls` path behind a `BatchSender`
  interface so the demo works today; swap by config when the ABI + address land.
- **Rows must be sorted strictly ascending by stealth address; duplicates rejected
  on-chain.** Frontend sorts before submit and shows the sorted order in Review.
- Metadata `viewTag(1)|selector(4)|token(20)|amount(32)` = SDK `buildMetadataForERC20`.
- **Pin meta-address per recipient at enrollment.** Sender app keeps `{input, registrant,
  metaAddress, pinnedAt}` locally. Every run still resolves fresh; if the live
  meta-address differs from the pin, the row turns into an alert and blocks until the
  employer accepts the new one. Stealth addresses are never stored between runs.
- Gateway mode and Privacy Pools are proposed cut from v1. Already out of this cut.
- Batch limit ~400-500 lines per tx. Frontend caps a run at 400 rows for now.

## App shape

One Next.js app. Top nav: **Receive** | **Pay** | **Settings**. Chain name in the header.
Two RPCs in config: `PAYROLL_CHAIN_ID` + RPC, and `MAINNET_RPC` for ENS only.
UI is plain on purpose: default HTML tables, buttons, text status, copy buttons. No design
pass, no component library decisions blocking work.

Client-side stores (recipient, all rebuildable from seed + chain, PRD invariant I4):
encrypted keys, registrant address, registration block, ledger cache, last scanned block.
Sender stores only an unsent draft.

## Key derivation decision (needs a yes)

PRD: "one seed the employee backs up; show backup once." SDK default:
`generateStealthMetaAddressFromSignature` derives spending + viewing keys from a wallet
signature. Recommendation: **signature-derived**. Recovery = same wallet signs the same
message. No seed phrase UI. Also derive the throwaway registrant key from the same
signature (domain-separated hash) so everything is recoverable from one signature.
Backup screen still exists: "Export keys" downloads a JSON of the three private keys,
shown once, with the loss warning the PRD requires. Wallet signs nothing on-chain.

## Receive: screens

**R1 Setup wizard** (one time, linear, four steps, progress bar at top)

```
Step 1  Derive keys
  [Connect wallet]  ->  [Sign to derive keys]
  Meta-address   st:eth:0x02ab...   [copy]
  Spending pub   0x02..  Viewing pub  0x03..
  Registrant     0x9f3...  (throwaway, never fund from your wallet)
  [Export backup JSON]  (i) Losing wallet + backup = losing funds
  [Next]

Step 2  Register on-chain (gasless)
  Registry  0x6538...6538 on <chain>
  Status: not registered
  [Register]  -> signs EIP-712 locally with registrant key
              -> POST /api/relay -> tx hash -> poll stealthMetaAddressOf
  Status: registered at block 31,204,118  tx 0xab.. [explorer]
  [Next]

Step 3  Link a name (optional)
  Input: alice.eth / alice.base.eth      [Check]
  Result: current addr = 0x000 (unset) | = registrant (linked) | = other (mismatch)
  "Set addr record to 0x9f3... from the wallet that owns the name."
  [Open ENS manager] [Open Basenames]   (no in-app tx for M1)
  [Skip: share address instead]

Step 4  Share
  Card: name (if linked) | registrant 0x9f3... | meta-address st:eth:0x...
  [Copy each]   "Give the sender any one of these."
  [Go to dashboard]
```

**R2 Dashboard** (home once set up)

```
Header   alice.eth | 0x9f3...  Base Sepolia   Last scan: block 31,210,004  [Rescan]
Total    1,500 USDC, 3 payments
Table    block | from (announce caller) | token | amount (metadata) | balance (live) | stealth addr [copy] | tx [link]
Empty    "No payments yet. Share your name or meta-address."  [Share card]
Errors   RPC down / scan failed / relayer down -> one red line at top, never silent
```

**R3 Payment detail** (row expand)

```
Stealth address (full) [copy]     Ephemeral pubkey     View tag
Metadata decoded: ERC-20 transfer, token, amount
Live balance                      Block / tx / sender
Spending private key  [reveal] [copy]   "Import into a wallet to spend. In-app spend is M2."
```

**R4 Settings**

```
Chain, RPC URLs (read-only from config)   Registrant   Registration block
[Export keys]   [Reset local data]  (keys are recoverable by signing again)
```

## Pay: screens

**P1 Batch editor**

```
[Connect wallet on <chain>]     Token: USDC (0x833..) balance 12,000
Paste one per line:  recipient, amount
  alice.eth, 500
  0x9f3...c2, 500                 <- registrant address
  st:eth:0x02ab...ef, 250         <- raw meta-address
[Resolve]
Row status: resolving | ok (registrant 0x.. -> meta st:eth:0x..) | error (name unresolved / no registry entry)
Rows go stale when edited; Resolve runs fresh every time. Nothing cached across runs.
Totals: 3 rows, 1,250 USDC, balance ok   (no approve: transfers come from the EOA itself)
[Continue]  (disabled until every row is ok)
```

**P2 Review**

```
Banner  "Fresh stealth addresses generated for this run only. Do not reuse."
Table   recipient | stealth address (new) | amount
Tx plan  3 transfers + 3 announces
        Wallet supports atomic batch (EIP-5792): "one transaction, one signature"
        Wallet does not: "two transactions: announce, then pay. Not atomic." [Continue anyway]
        [Send batch]
Progress  sending -> confirmed  (or: announcing -> paying -> confirmed)
```

**P3 Result**

```
tx 0x... [explorer]    status per row
"Ephemeral keys discarded."  [Export run CSV]  (recipient input, stealth address, amount, tx)
[New batch]
```

## Flows, end to end

Self-pay demo in one browser, no ENS: Receive R1 steps 1,2,4 (skip 3) -> copy meta-address
-> Pay P1 paste `st:eth:0x..., 10` -> P2 send -> Receive R2 Rescan -> row appears with
amount 10 from metadata and live balance 10 -> R3 reveal spending key.

## Backend dependencies surfaced

1. Relayer endpoint for `registerKeysOnBehalf` (mocked at `/api/relay`).
2. Indexer or subgraph for full-history scan (bounded RPC scan for now).
3. `StealthDisperse` ABI + address per chain (teammate). Frontend ships with the
   EIP-5792 path until then.
4. Platform-issued subnames if recipients should not need to own an ENS name (PRD mentions
   it, no component owns it).

## Out of this cut, deliberately

Spend, single-balance view, cluster graph, labels (M2). Gateway mode (M3). Denominated
payouts, Safe output, CCTP, Privacy Pools (M4). Saved groups, schedules (P2).

## Verification

- Self-pay demo above runs on the configured testnet with the mock relayer.
- Invariant I1: send two batches to the same meta-address; two distinct stealth addresses.
- Invariant I3: batch tx receipt contains N `Transfer` and N `Announcement` logs, each
  Announcement `caller` = sender EOA. Fallback path: announce tx confirms before pay tx.
- Sender wallet without EIP-5792: fallback banner appears, two txs, ledger still shows rows.
- Invariant I4: Reset local data, sign again, Rescan from registration block; ledger identical.
- Bad inputs: unresolvable name, address with no registry entry, malformed meta-address,
  amount over balance; each shows a row-level error, Continue stays disabled.
