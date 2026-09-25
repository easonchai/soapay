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

ENS runs on Ethereum Sepolia (registry `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`). `SoapayOffchainResolver` is deployed there and set as the resolver of `soapay.eth`, which works as a wildcard under ENSIP-10.

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

## 2. SoapayOffchainResolver (ENS CCIP-Read, EIP-3668 + ENSIP-10)

This follows the `ensdomains/offchain-resolver` pattern.

```solidity
function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory);
  // always reverts OffchainLookup(address(this), urls, callData, this.resolveWithProof.selector, callData)
  // callData = abi.encodeWithSelector(IResolverService.resolve.selector, name, data)
function resolveWithProof(bytes calldata response, bytes calldata extraData) external view returns (bytes memory);
  // response = abi.encode(bytes result, uint64 expires, bytes sig)
  // require(block.timestamp <= expires); require(signers[ecrecover(hash, sig)])
```

- **Signed hash:** `keccak256(abi.encodePacked(hex"1900", address(resolver), uint64 expires, keccak256(extraData /* = callData */), keccak256(result)))`.
- **Owner-managed:** `signers` mapping, `url`, `setSigners`, `setUrl` (Ownable2Step). The resolver holds no funds.
- **Gateway URL template:** `https://<api>/ccip/{sender}/{data}.json`, plus POST.
- **`supportsInterface`:** IExtendedResolver `0x9061b923` and ERC-165.

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
| `safe.ts` | guard | `encodeSafeMultiSendCallOnly(calls)` → `{to: MultiSendCallOnly v1.4.1, data, operation: 0}`. Never `MultiSend` or delegatecall to anything else. Plus a Safe Transaction Builder JSON export. |

Name claim, EIP-712: domain `{name: "Soapay Names", version: "1", chainId}`, type `NameClaim(string label, address registrant, string metaAddress, uint256 deadline)`, signed by the registrant key.

## 4. API (`apps/api`, Hono on Node, SQLite via `node:sqlite`)

| Route | Does |
| --- | --- |
| `GET /health` | Liveness, plus chain ids and indexer head |
| `POST /register` | `{registrant, metaAddress, signature}` → simulate, then send `registerKeysOnBehalf` from `RELAYER_PRIVATE_KEY` → `{txHash}`. Rate limit per IP and registrant; refuse if the registry already holds the same meta-address. |
| `POST /names` | `{label, registrant, metaAddress, deadline, signature}` → verify the EIP-712 NameClaim, check `stealthMetaAddressOf(registrant,1) == metaAddress`, check the label is free and valid (`[a-z0-9-]{3,32}`) → store |
| `GET /names/:label` | Public record, for debugging |
| `GET\|POST /ccip/:sender/:data` | Decode `resolve(name, data)` and answer `text(node,"stealth")`, `text(node,"soapay:registrant")`, `addr(node)` and `addr(node, coinType)` with the **zero address** (plain wallets must fail, not pay a static address). Sign with `CCIP_SIGNER_PRIVATE_KEY` (hash above, TTL 5 min) and return `{data: abi.encode(result, expires, sig)}` |
| `GET /announcements?from=&to=&cursor=` | All Announcer events, scheme 1, paginated. The indexer backfills from `ERC5564_StartBlocks` in chunks, then polls the tip. No filtering by recipient. |

**Env:** `PORT`, `CHAIN_ID` (84532 by default), `RPC_URL`, `L1_RPC_URL`, `RELAYER_PRIVATE_KEY`, `CCIP_SIGNER_PRIVATE_KEY`, `RESOLVER_ADDRESS`, `DB_PATH`.

## Actions only the team can do

- Broadcast deploys with your own keystore; agents never handle deployer keys.
- Own `soapay.eth` on Sepolia and set its resolver.
- Fund the relayer key with Base Sepolia ETH.
- Provide a bundler URL (Pimlico or similar).
