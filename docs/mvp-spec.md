# MVP spec: contracts, SDK, API

The shared interfaces for the parallel workstreams. If this spec is wrong, fix the spec first, then the code.

## MVP loop (testnet: Base Sepolia + Ethereum Sepolia for ENS)

1. **Recipient onboards.** Seed → spending, viewing and registrant keys → `POST /register` (relayer submits `registerKeysOnBehalf`) → `POST /names` (claim `label.soapay.eth`).
2. **Sender enrolls.** Resolve `alice.soapay.eth` once, read the `stealth` text record, cross-check it against ERC-6538, and **pin** the meta-address.
3. **Pay run.** Derive a line per payment, check that no ephemeral key repeats, sort globally, cut into chunks of 350 lines or fewer, then send through `StealthDisperse.pay` (EOA) or an EIP-5792 batch (smart account).
4. **Recipient scans.** `GET /announcements` → filter by view tag locally → recompute the stealth address → read the real USDC balance.
5. **Recipient spends.** EIP-7702 authorization to `Simple7702Account` + a userOp on EntryPoint v0.8, with a USDC paymaster.

## Networks

| | Base Sepolia (84532) | Base (8453) |
| --- | --- | --- |
| ERC-5564 Announcer | `0x55649E01B5Df198D18D95b5cc5051630cfD45564` | same |
| ERC-6538 Registry | `0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538` | same |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| EntryPoint v0.8 | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` | same |
| 7702 delegate (Simple7702Account, eth-infinitism) | `0xe6Cae83BdE06E4c305530e199D7217f42808555B` | same |
| StealthDisperse | CREATE2, salt `keccak256("soapay.StealthDisperse.v1")` | not deployed |

ENS runs on **ENSv2 on Ethereum Sepolia**: `soapay.eth` has its own subname registry, and each employee gets an on-chain subname with a Permissioned Resolver. Enhanced Access Control lets only the employee's registrant key edit that name's `stealth` record. Addresses are recorded in §2 once verified.

## 1. StealthDisperse packed calldata (replaces the struct ABI)

Each line is **64 bytes**: two words, down from about 256 B.

```solidity
struct PackedPayment { uint256 head; bytes32 keyX; }

function pay(IERC20 token, PackedPayment[] calldata lines) public;
function payWithPermit(IERC20 token, PackedPayment[] calldata lines,
                       uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
```

`head` bit layout, big-endian:

| Bits | Field |
| --- | --- |
| 255..96 | `stealthAddress` (160) |
| 95..16 | `amount` (uint80, max ≈ 1.2e24 base units; per line) |
| 15..8 | `viewTag` (8) |
| 7..0 | `keyPrefix` (8), must be `0x02` or `0x03` |

```text
head = (uint256(uint160(stealth)) << 96) | (amount << 16) | (viewTag << 8) | keyPrefix
ephemeralPubKey = abi.encodePacked(bytes1(keyPrefix), keyX)   // 33 bytes, passed to announce()
```

- **Validation, in this order:** stealth addresses strictly ascending (`NotAscending(i)`; this also rejects address(0) and duplicates), then `ZeroAmount(i)`, then `BadEphemeralKey(i)` for any prefix other than 0x02/0x03.
- **Metadata:** unchanged, 77 bytes: `viewTag | 0xa9059cbb | token | uint256 amount | payer`.
- **Salt:** unchanged, since nothing has been deployed yet.
- **Clients** reject an amount ≥ 2^80 before encoding.

## 2. Names on ENSv2 (Sepolia), replacing the ENSv1 off-chain resolver

Decided 2026-09-25: this qualifies for the ENSv2 prize and removes trust in a gateway signer.

- **Parent.** `soapay.eth` is on ENSv2 Sepolia and owned by the team. It has its own **Permissioned Registry** for subnames.
- **Issuer.** The API's issuer key holds only the EAC role to register subnames under `soapay.eth`; it has no other rights.
- **Per employee:** the subname `label.soapay.eth` gets:
  - its own **Permissioned Resolver**;
  - records: text `stealth` = meta-address URI, text `soapay:registrant` = registrant;
  - `addr` left **unset**, so plain wallets can't pay a static address;
  - EAC roles: the registrant key may set **only** the `stealth` text record. The subname is **non-transferable**, and the parent can revoke it.
- **Rotation.** A meta-address change is an on-chain `setText` by the registrant, gated off-chain by a World ID re-verification (§5). The sender's pin check (`pinnedMetaChanged`) alerts the employer.
- **Resolution.** viem `getEnsText` through the ENSv2 Universal Resolver on Sepolia.

The exact contract addresses, role ids and calls are in `contracts/ENSV2.md` (the ENSv2 workstream).


### 2.1 Key rotation under option A (owner decision, 2026-09-25)

World ID 4.0 proofs can't be verified on-chain on Sepolia (only on World Chain and Arc). So the **registrant keeps the ENSv2 `stealth` writer role** (the ENS story: only the employee controls their record), and the **sender app is the enforcement point**:

1. **Recipient app:** `proveSession(saved session_id)`, then `POST /names/:label/rotation {newMeta, deadline, registrantSig (EIP-712 RotationClaim), worldIdResult}`.
2. **API:**
   - verifies that the session_id matches the name's enrolled session, that the session_nullifier hasn't been used, and that the registrant signature is valid;
   - issues an **EIP-712 attestation** signed by `ATTESTER_PRIVATE_KEY`: `MetaRotation(string label, string oldMeta, string newMeta, uint256 verifiedAt)`. It is stored and served at `GET /names/:label/attestations`;
   - **sponsors the registrant's Sepolia gas** for the `setText` (a small top-up from the L1 relayer). The registrant is already public, so this links nothing new.
3. **Registrant:** calls `setText(stealth)` on its own Permissioned Resolver. The rotation request also carries a fresh `registerKeysOnBehalf` signature for the new meta-address. The API relays it to the ERC-6538 registry on Base in the same World-ID-gated request, so `resolveStealthMeta`'s registry cross-check keeps passing. The rotation doesn't count against the once-per-human `/register` allowance.
4. **Sender app:** re-resolves before each run. A changed pin is **auto-accepted only with a valid attestation**: the signer equals the configured attester and `newMeta` matches. It then shows a "re-verified by World ID" badge. Otherwise the line is blocked until the employer approves it by hand.

A stolen registrant key can change the record, but it can't get paid without either the same human's World ID or the employer's explicit approval.

**Shared formats (the API and the sender app must match exactly):**
- **RotationClaim** (signed by the registrant key), EIP-712 domain `{name:"Soapay Names", version:"1", chainId: API CHAIN_ID}`, type `RotationClaim(string label, string oldMeta, string newMeta, uint256 deadline)`. Meta-addresses are in canonical lowercase `st:eth:0x…` form.
- **MetaRotation attestation** (signed by `ATTESTER_PRIVATE_KEY`), domain `{name:"Soapay Attestations", version:"1", chainId: API CHAIN_ID}`, type `MetaRotation(string label, string oldMeta, string newMeta, uint256 verifiedAt)`.
- `GET /names/:label/attestations` → `{attester: "0x…", items: [{label, oldMeta, newMeta, verifiedAt: "<unix s>", signature}]}`, newest first. `GET /worldid/config` also returns `attester`.
- The sender app pins the attester address via `VITE_ATTESTER` (it must not trust the address in the response alone) and verifies with viem `verifyTypedData`.

## 3. SDK modules (`packages/sdk/src`)

| File | Owner | Exports |
| --- | --- | --- |
| `constants.ts` | done | chain addresses per chain id (the table above) |
| `abis.ts` | done | Announcer, Registry, StealthDisperse (packed), OffchainResolver, ERC-20 |
| `keys.ts` | identity | `generateMnemonic`, `keysFromMnemonic(m) → {spendingKey, viewingKey, registrantKey, spendingPublicKey, viewingPublicKey, metaAddressURI}` at BIP-32 paths `m/5564'/1'/0'` (spend), `m/5564'/1'/1'` (view), `m/5564'/1'/2'` (registrant) |
| `registration.ts` | identity | `signRegisterKeysOnBehalf` (EIP-712 for ERC-6538, nonce read from the registry), `buildNameClaim` / `signNameClaim` (EIP-712 below) |
| `names.ts` | identity | `resolveStealthMeta(client, name)`: text `stealth` + text `soapay:registrant`, cross-checked against `stealthMetaAddressOf(registrant, 1)` |
| `payrun.ts` | payrun | `derivePayRun(recipients[{metaAddressURI, amount}])`, `chunkLines(lines, max=350)`, `encodeHead`/`decodeHead`, `encodeStealthDisperseCalls`, `encodeBatchCalls` (EIP-5792: `[transfer, announce] × N` with 57-byte standard metadata) |
| `scan.ts` | payrun | `fetchAnnouncements(api \| client)`, `scanAnnouncements(anns, keys) → matches`, `parseMetadata`, `verifyBalances(client, matches)` |
| `spend.ts` | spend | `spendFromStealth({stealthKey, to, amount, bundlerUrl, paymaster})`: 7702 auth + userOp, USDC paymaster |

| `guard.ts` | guard | Pure library, no I/O (PRD P1). `ClusterGraph`: each stealth address starts in its own cluster. `planSpend({from[], to}) → {mergedClusters, warnings, blocked}`. A destination is identifiable if it is labelled (`main-wallet`, `exchange`, `coworker-known`, `other`) or already appears in a cluster that touched a labelled address. Coworker-known wallets count as identifiable **by default** (CLAUDE.md). Merge → warning; sending to an identifiable destination → blocked unless `override: true`. Serializable with `toJSON`/`fromJSON`. |
| `denominations.ts` | guard | `splitIntoDenominations(amount, chunk)` → chunks plus a remainder policy: `{mode: "exact"}` adds one odd chunk (no wage carry-over, the default, because carry-over under- or over-pays wages) or `{mode: "carry", carryIn}` rounds and returns `carryOut`. `smallTeamWarning(n)` when there are fewer than 10 recipients. |
| `safe.ts` | guard | `encodeSafeMultiSendCallOnly(calls)` → `{to: MultiSendCallOnly v1.4.1 0x9641d764fc13c8B624c04430C7356C1C7C8102e2, data, operation: 1}`. The Safe must DELEGATECALL MultiSendCallOnly, and only that pinned address; every inner call is operation 0, and inner delegatecalls are rejected. Never `MultiSend`. Plus a Safe Transaction Builder JSON export. |

Name claim, EIP-712 (`metaAddress` is signed in canonical lowercase `st:eth:0x…` form): domain `{name: "Soapay Names", version: "1", chainId}`, type `NameClaim(string label, address registrant, string metaAddress, uint256 deadline)`, signed by the registrant key.

## 4. API (`apps/api`, Hono on Node, SQLite via `node:sqlite`)

| Route | Does |
| --- | --- |
| `GET /health` | Liveness, plus chain ids and indexer head |
| `POST /register` | `{registrant, metaAddress, signature}` → simulate, then send `registerKeysOnBehalf` from `RELAYER_PRIVATE_KEY` → `{txHash}`. Rate limit per IP and registrant; refuse if the registry already holds the same meta-address. |
| `POST /names` | `{label, registrant, metaAddress, deadline, signature}` → verify the EIP-712 NameClaim, check `stealthMetaAddressOf(registrant,1) == metaAddress`, check the label is free and valid (`[a-z0-9-]{3,32}`) → store |
| `GET /names/:label` | Public record, for debugging |
| `GET /announcements?from=&to=&cursor=` | All Announcer events, scheme 1, paginated. The indexer backfills from `ERC5564_StartBlocks` in chunks, then polls the tip. No filtering by recipient. |

`POST /register` and `POST /names` call a pluggable `HumanVerifier` (World ID, §5) and `POST /names` calls a pluggable `NameIssuer` (ENSv2, §2).

**Env:** `PORT`, `CHAIN_ID` (84532 by default), `RPC_URL`, `L1_RPC_URL`, `RELAYER_PRIVATE_KEY`, `ISSUER_PRIVATE_KEY`, `WORLD_APP_ID`, `WORLD_RP_ID`/signing key (§5), `DB_PATH`.

## 5. World ID (IDKit): self-service key rotation, a single trust moment

Owner decision (2026-09-25, supersedes the earlier two-moment design):
- **No enrollment gate.** Onboarding doesn't require World ID, and there's no Orb requirement. Relayer abuse is handled with rate limits (employer invite links later if needed).
- **Trust moment: key rotation / recovery.** Changing the meta-address behind a name redirects future salary. At enrollment the employee MAY create a World ID **session** with the **Selfie Check** credential (`selfieCheck`; the docs recommend sessions for repeated verification, and no Orb is needed). A later rotation must prove that same session (`proveSession`). The API verifies it and issues the MetaRotation attestation (§2.1), and the sender app auto-accepts.
- **Why Selfie Check is the minimum sufficient assurance:** rotation asks "is this the same person who enrolled?" (continuity), not "is this a unique human?" (uniqueness). Proof of Human would add an Orb requirement without answering that question any better.
- **Alternative paths:** no session enrolled, a cancelled or expired proof, a different person (session mismatch), or a replayed session_nullifier → no attestation → the sender app blocks the line and the employer approves by hand.
- **Where it's essential:** DAO contributors are often pseudonymous, so the payer has no out-of-band channel to confirm a change; World ID is the only continuity signal that keeps the contributor pseudonymous. For known employees it automates what HR would otherwise confirm by phone.
- Proofs are verified server-side in `apps/api`. We store session_id per name and used session_nullifiers, never identity. The `soapay-enroll` action exists in the Portal but is unused (sessions take no action).

## 6. Uniswap: convert salary in place

- The recipient app lets an employee convert part of a stealth address's USDC into another asset **inside the same stealth address**: one 7702 userOp does `approve` + a Uniswap API swap calldata, with gas paid in USDC by the paymaster. No funds move between addresses, so no clusters merge.
- The conversion preference is **local** to the recipient app (never a public record, which could fingerprint someone).
- `FEEDBACK.md` at the repo root, and the Uniswap feedback form, are required for the prize.

## 7. Invite links (owner decision, 2026-09-25)

Lets the employer pre-assign the label so the employee's onboarding is: open the link, back up the seed, tap Create.

- **Invite typed data** (signed by the employer's connected wallet; verified with viem `verifyTypedData` through a public client, so ERC-1271/6492 smart wallets work too): domain `{name:"Soapay Names", version:"1", chainId: API CHAIN_ID}`, type `Invite(string label, address employer, bytes32 codeHash, uint256 expiresAt)`. `code` is 32 random bytes generated in the sender app; `codeHash = keccak256(code)`. The default expiry is 14 days and the maximum is 30.
- **`POST /invites`** `{label, employer, codeHash, expiresAt, signature, org?}` checks the signature and label validity, and that the label is neither claimed nor reserved by an unexpired invite. It **reserves** the label, returns `{codeHash, expiresAt}` and is rate-limited per employer and per IP.
- **`GET /invites/:codeHash`** → `{label, employer, org?, expiresAt, status: "pending"|"claimed"|"expired", name?}`.
- **`POST /names`** accepts an optional `inviteCode` (0x-hex 32 bytes). A label reserved by an unexpired invite can only be claimed with a code whose keccak256 matches; the invite is then marked claimed. An unreserved label works as before, with no code needed.
- **Link format:** `${RECIPIENT_URL}/#/join?code=<0x…>&label=<label>&org=<org>`. `label` and `org` are display hints; the truth comes from `GET /invites/:codeHash`.
- **Sender app:** "Invite employee" (label, amount, optional org name) → sign → POST /invites → show the link plus a QR code. The roster row stays "Invited (pending)" until the invite is claimed, then auto-enrolls by resolving and pinning with the normal checks. The code is kept only in the employer's encrypted vault.
- **Recipient app:** on `#/join?...`, prefill and lock the label and show "Invited by <org>". POST /names includes `inviteCode`. Expired or claimed invites show a clear error and let the employee pick their own label.

## 8. MCP server: agents as ENSv2 namespaces (owner decision, 2026-09-26)

`apps/mcp` (`@soapay/mcp`) is a stdio MCP server over the SDK and API (PRD M5, pulled forward for the ENSv2 prize's "agents as namespaces" bonus).
- **Agent identity:** each agent gets `<label>.soapay.eth` through the normal onboarding (sponsored ERC-6538 registration, then POST /names). It carries ENSIP-26 agent text records, and an ENSIP-25 registry binding if the spec supports it without a live registry. Only the agent's registrant key can change its `stealth` record (the same EAC model as employees).
- **Tools:**
  - `whoami`: the agent's name, meta-address and balance;
  - `resolve_name`;
  - `pay`: names and amounts, as one pay run through StealthDisperse or a batch;
  - `scan` / `balance`;
  - `spend`: to an address or a name, with guard-checked 7702 + paymaster;
  - `swap_in_place`: through the Uniswap proxy;
  - `create_agent_identity`.
- **Guardrails:**
  - per-call and per-day USDC caps (env);
  - `dry_run: true` by default for pay and spend (it returns the plan; a second call with `confirm: <planId>` executes it);
  - the consolidation guard is enforced, and `block` is never overridden by the agent;
  - optional payee allowlist;
  - keys only from env or files, never returned by any tool.
- **Keys:** `AGENT_MNEMONIC` (the agent as recipient) and `AGENT_PAYER_PRIVATE_KEY` (the agent as payer, an EOA with USDC).

## 9. Compliant exit through Privacy Pools (owner decision, 2026-09-26)

Research, addresses and sources are in `docs/exit-research.md`. The production chain is deliberately undecided, so the SDK is chain-agnostic, with a config per chain. The testnet demo route is Base Sepolia → Ethereum Sepolia (0xbow USDC pool).

**SDK `packages/sdk/src/exit.ts`** (interface; the recipient app codes against this):
```ts
type ExitConfig = { source: SoapayChainId; dest: number; cctp: {...}; pool: { entrypoint; pool; asset; minDeposit }; aspApiUrl; relayerUrl; forwarding: true };
type ExitLeg = {                         // one per stealth address, never combined
  id: string; stealthAddress: Address; amount: bigint;
  status: 'planned'|'burning'|'awaiting-mint'|'minted'|'depositing'|'pending-asp'|'approved'|'declined'|'withdrawing'|'done'|'refunded'|'failed';
  txs: { burn?: Hash; mint?: Hash; deposit?: Hash; withdraw?: Hash; refund?: Hash }; poolIndex: number; error?: string; updatedAt: number };
planExit(p: { sources: {stealthAddress, amount}[]; destination: Address; config }): { legs: ExitLeg[]; fees: {...}; warnings: string[] }
advanceExitLeg(ctx: { spendClient(s) per chain, stealthKey, poolSecrets, config, fetch }, leg): Promise<ExitLeg>   // idempotent step machine, resumable
derivePoolSecrets(keys: { spendingKey }, poolIndex): { nullifier; secret }   // deterministic from the seed, so a lost device recovers
withdrawToDestination(...) // through the 0xbow relayer; round partial amounts; suggestedDelayMs
```
**Rules:**
- One userOp per stealth address, and no ETH ever sent to a stealth address.
- The mint lands back on the same stealth address (the forwarding service pays).
- The deposit is approve + `Entrypoint.deposit` through `executeFromStealth` on the destination chain.
- Declined deposits go back through ragequit (`refunded`).
- The state is serializable (it lives in the recipient's encrypted vault).
- Every leg is resumable after a reload.

**Recipient app:** when `planSpend` blocks an identifiable destination, offer "Exit through Privacy Pools" in place of the override.
- A per-leg progress timeline, with the ~10–12 min ASP wait shown honestly.
- Resumable across reloads.
- Copy on remaining linkability: amounts and timing; round partial withdrawals and random delays are recommended.

## Actions only the team can do

- Broadcast deploys with your own keystore; agents never handle deployer keys.
- Own `soapay.eth` on Sepolia and set its resolver.
- Fund the relayer key with Base Sepolia ETH.
- Provide a bundler URL (Pimlico or similar).
