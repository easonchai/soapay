# StealthDisperse: plan

## Goal
One transaction per pay run that pays N ERC-5564 stealth addresses on Base and announces each one, so every recipient's scanner finds its line and no coworker in the batch can tell which line belongs to whom (beyond what amounts reveal).

Threat model (agreed, overrides PRD): the only adversary is a coworker in the same batch. The employer is trusted. ENS is only a reference identifier; the sender app pins each recipient's ERC-6538 meta-address at enrollment and derives fresh stealth addresses client-side every run. Gateway mode, Privacy Pools and chain-analyst threats are out of scope.

## Contract spec: `src/StealthDisperse.sol`
- Packed calldata ABI (docs/mvp-spec.md §1): `struct PackedPayment { uint256 head; bytes32 keyX; }`, 64 bytes per line.
  - `head` = `stealthAddress(160) << 96 | amount(uint80) << 16 | viewTag(8) << 8 | keyPrefix(8)`, big-endian.
  - `ephemeralPubKey = abi.encodePacked(keyPrefix, keyX)`: the 33-byte compressed key, rebuilt on-chain for `announce`.
  - `decodeHead(uint256) → (stealthAddress, amount, viewTag, keyPrefix)` is a public pure helper (no validation), used by `pay` and by the tests.
  - Clients reject `amount >= 2^80` before encoding; the contract cannot detect an overflowing amount because it would spill into the address bits.
- `pay(IERC20 token, PackedPayment[] lines)`: for each line, decode the head, `safeTransferFrom(msg.sender, stealthAddress, amount)`, then `ANNOUNCER.announce(1, stealthAddress, prefix ‖ keyX, metadata)`.
- `payWithPermit(token, lines, value, deadline, v, r, s)`: best-effort EIP-2612 permit (try/catch, so a front-run permit cannot block the payment). If the allowance is still below the batch total afterwards it reverts `PermitFailed()`, then calls `pay`. This path is for plain EOAs only: on Base USDC, a permit for a 7702-delegated or smart-account owner goes through ERC-1271 and usually fails. Those accounts approve and pay in one EIP-5792 atomic batch instead.
- Rejects, checked in this order per line: `NotAscending(i)` (addresses must be strictly ascending, which rules out duplicates and address(0)), `ZeroAmount(i)`, `BadEphemeralKey(i)` (prefix is not 0x02/0x03), `PermitFailed()`.
- The ascending rule guards against bugs in the employer's own app and dedupes lines within a batch. It is not a privacy guarantee on its own; see the client invariants.
- Metadata (77 bytes): the 57 standard EIP-5564 bytes `viewTag(1) | 0xa9059cbb transfer selector(4) | token(20) | amount(32)`, then `payer(20)` = `msg.sender`. `Announcement.caller` is always this contract, so the payer suffix is what lets scanners drop spam: anyone can call `pay` with a fake token.
- **Scanners MUST** recompute the stealth address from `ephemeralPubKey`, read the actual token balance, and never trust the token or amount in the metadata. The payer field is only a filter hint.
- No state, no owner, no funds held, no upgradeability. Validation and metadata live in `_validate` and `_metadata` so rule changes stay local.

## Verified against canonical sources
- The ERC5564Announcer is at `0x55649E01B5Df198D18D95b5cc5051630cfD45564` on Base (ScopeLift README). The runtime bytecode was read from Base mainnet and is used verbatim in the tests via `vm.etch`. The fork test asserts it still matches.
- ABI: `announce(uint256,address,bytes,bytes)`. Event: `Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)`. `caller` is `msg.sender` of `announce`, which is this contract, not the employer.
- EIP-5564 token metadata: byte 1 view tag, bytes 2-5 function selector, bytes 6-25 token, bytes 26-57 amount. The design matches this.
- Scheme 1 ephemeral key: the ScopeLift SDK emits 33-byte compressed keys, so packing them as prefix + 32-byte x is lossless.
- Base USDC is `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (symbol USDC, 6 decimals, FiatToken v2, checked on-chain).

## Deviations from the starting design
1. Added a 0x02/0x03 prefix check on the ephemeral key. It is cheap and rejects uncompressed or garbage keys. With the packed ABI the key is always 33 bytes by construction, so the old length checks (0/32/65 bytes) no longer exist. An invalid key means the recipient's scanner never finds the payment. It does not check that the key is on the curve; that stays client-side.
2. The selector is kept as `transfer` but named as the constant `METADATA_SELECTOR`. The actual call is `transferFrom`, but `0x23b872dd` is shared with ERC-721, so a scanner could not tell whether bytes 26-57 hold an amount or a token id.
3. `ZeroAmount` is checked before the key check. This only changes which error wins when a line has several faults.
4. The interface declares the `Announcement` event so tests can use `vm.expectEmit`. The call ABI is unchanged.
5. Review H1: `payWithPermit` checks the allowance after the permit and reverts `PermitFailed` instead of failing silently.
6. Review M1: the payer suffix is added to the metadata (77 bytes).
7. Packed calldata (docs/mvp-spec.md §1, open question 5): `PackedPayment{head, keyX}` replaces the `Payment` struct. Per-line amount is capped at 2^80 - 1 (≈ 1.2e18 USDC). `EPHEMERAL_KEY_LENGTH` is gone and `decodeHead` is new. Validation order, metadata, announce, permit handling and the CREATE2 salt are unchanged.

## Invariants
- The contract's token balance is always 0. Every line moves exactly `amount` from `msg.sender` to `stealthAddress`.
- Funds are only ever pulled from `msg.sender`. The permit signer is `msg.sender`, so a third party cannot use an employer's allowance or signature.
- Each successful line produces exactly one Transfer and one Announcement, in the same order. Any failure reverts the whole batch.
- On-chain line order is a function of the stealth addresses alone. That removes one class of employer-app bug; it is not a privacy guarantee by itself.

## Client invariants (sender app; the contract cannot enforce these)
- **Multi-tx runs:** derive every line for the whole run, sort globally by stealth address, then cut into roughly equal txs. Never partition by employee; per-tx totals would reveal salaries (review H2).
- **Batch cap:** at most 350 lines per tx. Measured all-in cost with packed calldata is about 37.8k gas per line on real USDC, so the 2^24 EIP-7825 cap fits about 444 lines; with the older 42k planning figure it is ~398. 350 keeps ≥ 12% margin either way (review M3).
- **Amounts:** reject any line amount ≥ 2^80 or = 0 before encoding the head.
- **No ephemeral key reuse:** check that no ephemeral key repeats across lines. A repeat means an RNG bug (review M4).
- **Safe employers:** use `MultiSendCallOnly` with operation=0 (never `MultiSend`), and approve exactly the total (review L3).

## Recommended payment paths (for the team to confirm; not yet decided)
- The contract is a USDC blacklist chokepoint: if Circle blacklists it, every employer on this path stops (review M2/S1). Recommendation:
  - Smart-account, 7702 and Safe employers use a contract-less EIP-5792 atomic batch of `[USDC.transfer(stealth, amt), Announcer.announce(...)] × N`. There `caller` is the employer and no allowance is needed.
  - StealthDisperse is the path for plain EOAs.
- StealthDisperse is immutable and stateless, so moving to a redeployed address is only a config change in the sender app.

## Test matrix (`forge test -vv`)
| Area | Tests |
| --- | --- |
| Announcements | one exact `Announcement` per line (`expectEmit` against the real bytecode); raw-log decode of the 33-byte key (prefix, keyX) and metadata byte offsets; SDK-encoded vectors; max amount 2^80 - 1 |
| Packed encoding | fixed `decodeHead` vectors (below); fuzz encode→decode lossless for amounts < 2^80; fuzz decode→encode is the identity on every uint256 |
| Validation | out of order, duplicate, address(0), zero amount, key prefix 0x04/0x00/0x01/0xff, precedence (order > amount > key), empty batch is a no-op |
| Atomicity | insufficient balance on the last line and a false-returning token both revert the whole batch with no partial transfers; a token with no code reverts |
| Auth | a coworker cannot spend the employer's allowance; a coworker paying with their own funds does not touch the employer (and the payer suffix names the coworker); a coworker replaying the employer's permit fails |
| Permit | happy path; a front-run permit still pays; an existing allowance plus a junk permit still pays; a bad signature, a permit below the total, or a coworker replay reverts `PermitFailed`; fork: a 7702-delegated owner's ECDSA permit on real USDC reverts `PermitFailed` |
| Fuzz | batch size 1-64 with random amounts (sum, log count, key, metadata); an adjacent swap always reverts at the right index |
| Gas | 10/100/300 lines (`GasTest`), asserts 64 B/line and that the EIP-7623 floor does not bind |
| Fork | real Base USDC and the real Announcer (`BASE_RPC_URL=... forge test --match-contract Fork -vv`, skipped otherwise) |

### SDK test vectors (`encodeHead` / `decodeHead`)
Used in `test_decodeHead_fixedVectors` and `test_pay_sdkEncodedVectors`; the SDK should reuse them.

| head | stealthAddress | amount | viewTag | keyPrefix |
| --- | --- | --- | --- | --- |
| `0x320ea225f1022f09e9fad52227e35f3006cfcee10000000000003b9aca00e103` | `0x320Ea225F1022f09e9fad52227E35f3006CfCEe1` | 1000000000 | 0xe1 | 0x03 |
| `0x8425d6ef91098fc4b35480297a1558fa6f333a140000000000003baa0c404c03` | `0x8425d6Ef91098FC4b35480297A1558Fa6f333A14` | 1001000000 | 0x4c | 0x03 |
| `0xe59d5dc83861e5a443a0007b9dd486e8a928287e0000000000003bb94e80d202` | `0xE59d5dC83861e5A443A0007b9DD486e8a928287E` | 1002000000 | 0xd2 | 0x02 |
| `0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff02` | `0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF` | 2^80 - 1 | 0xff | 0x02 |
| `0x0000000000000000000000000000000000000001000000000000000000010003` | `0x0000000000000000000000000000000000000001` | 1 | 0x00 | 0x03 |

keyX for the first three (real ScopeLift scheme-1 lines, ephemeral key = prefix ‖ keyX):
`0xaf241a561b7b361c7e4361ce6f1e442937de4e972220c5b249b812dbbd227d8e`,
`0x88105b7df8faf26c35b21157ba127296072873ed4a19a05c43a37c094752b747`,
`0xdf30a6c82fde0aee7e395dd3fb5abbba9be4874140c4b3524a9e613517963e5a`.

### Gas and calldata (packed ABI)
Calldata is 64 B per line plus 100 B fixed (selector, token, array offset, length), down from about 256 B per line. That is about 960 calldata gas per line (EIP-2028), down from about 1.8k; the EIP-7623 floor does not bind because execution dominates.

| Lines | Mock ERC20 tx gas/line (incl. 21k + calldata) | Real Base USDC exec/line | USDC calldata/line | USDC tx gas/line |
| --- | --- | --- | --- | --- |
| 10 | 38.6k | 39.7k | 1.0k | 42.8k |
| 100 | 35.1k | 36.6k | 0.94k | 37.8k |
| 300 | 34.9k | 36.7k | 0.94k | 37.8k |

Before packing (struct ABI) the mock figures were 40.6k / 37.2k / 37.3k. Batch cap: 2^24 = 16,777,216 gas. At the measured USDC all-in cost of 37,755 per line that is 444 lines; at the old 42k planning figure it is 398. The 350-line cap still holds: 350 × 37,755 ≈ 13.2M gas, about 21% under the cap (12% at 42k). Recipients are fresh addresses (cold, zero balance), as in production.

## Deploy
1. `forge test` (and the fork test with `BASE_RPC_URL`).
2. `forge script script/Deploy.s.sol --rpc-url base --account <keystore> --broadcast --verify` (needs `BASE_RPC_URL`, `BASESCAN_API_KEY`). This is a CREATE2 deploy through the standard 0x4e59…956C deployer with salt `keccak256("soapay.StealthDisperse.v1")` (override with `SALT`). The script refuses to deploy if the Announcer is missing and is idempotent if the contract is already deployed.
3. Record the address in the sender app. Run one 1-line USDC pay and confirm the recipient app finds it.

## Tools
`tools/derive.ts` (ScopeLift SDK): `pnpm derive st:eth:0x…=<amount> …` prints sorted lines with their packed `head`/`keyX` words (round-trip checked) and a `cast` `(uint256,bytes32)[]` tuple. `--demo N` generates recipients and self-checks that each one can scan and spend its line.

## Open questions
1. **Amounts are the main remaining leak under this threat model.** A coworker who knows or guesses a colleague's salary finds their line directly. The contract already allows several lines per person (split into denominations, each to a fresh stealth address). Should the sender app do that by default?
2. Metadata selector: keep `transfer` (unambiguous for scanners) or use `transferFrom` (literal)? Check what the recipient scanner expects.
3. **Decided: clients only, contract stays stateless.** Whether scanners require a known payer (from the metadata suffix) or only rank by it is a scanner setting; the contract does not change.
4. **Decided: clients only, contract stays stateless.** v1 restricts tokens to USDC in the sender app; no on-chain allowlist (that would need state and an owner). Fee-on-transfer or rebasing tokens would make metadata amounts wrong, and scanners already read real balances.
5. **Resolved:** packed calldata (`head` + `keyX`, 64 B/line) per docs/mvp-spec.md §1; see deviation 7 and the gas table.
6. Confirm the recommended payment paths above (EIP-5792 batch for smart accounts, StealthDisperse for EOAs).
